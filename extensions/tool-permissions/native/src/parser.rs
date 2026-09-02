use crate::contract::{NativeOperation, ParseRequest, ParseResponse, ParsedSubcommand};
use bash_ast::ast::{
    AssignmentTarget, AssignmentValue, Command, CommandArgument, CommandNameInner,
    CompoundStatement, DeclarationPart, PrimaryExpression, Redirect, SimpleRedirect, Statement,
    StringPart,
};
use bash_ast::parse_to_ast;

fn source_slice(source: &str, start: usize, end: usize) -> String {
    source[start..end].to_owned()
}

fn strip_wrapped(text: &str, prefix: &str, suffix: &str) -> String {
    if text.starts_with(prefix)
        && text.ends_with(suffix)
        && text.len() >= prefix.len() + suffix.len()
    {
        text[prefix.len()..text.len() - suffix.len()].to_owned()
    } else {
        text.to_owned()
    }
}

fn primary_range(primary: &PrimaryExpression) -> (usize, usize) {
    match primary {
        PrimaryExpression::AnsiCString(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::ArithmeticExpansion(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::BraceExpression(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::CommandSubstitution(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::Expansion(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::Number(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::ProcessSubstitution(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::RawString(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::SimpleExpansion(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::StringNode(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::TranslatedString(v) => (v.span.byte_start, v.span.byte_end),
        PrimaryExpression::Word(v) => (v.span.byte_start, v.span.byte_end),
    }
}

fn string_parts_text(
    parts: &[StringPart],
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    parts
        .iter()
        .map(|part| match part {
            StringPart::Content(v) => Ok(v.text.clone()),
            StringPart::Raw { text, .. } => Ok(text.clone()),
            StringPart::SimpleExpansion(v) => {
                Ok(source_slice(source, v.span.byte_start, v.span.byte_end))
            }
            StringPart::CommandSubstitution(v) => {
                nested.extend(v.body.clone());
                Ok(source_slice(source, v.span.byte_start, v.span.byte_end))
            }
            StringPart::Expansion(_) | StringPart::ArithmeticExpansion(_) => {
                Err("unsupported syntax: dynamic expansion".into())
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join(""))
}

fn primary_text(
    primary: &PrimaryExpression,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    match primary {
        PrimaryExpression::RawString(v) => Ok(strip_wrapped(&v.text, "'", "'")),
        PrimaryExpression::Word(v) => Ok(v.text.clone()),
        PrimaryExpression::AnsiCString(v) => Ok(strip_wrapped(&v.text, "$'", "'")),
        PrimaryExpression::BraceExpression(v) => Ok(v.text.clone()),
        PrimaryExpression::Number(v) => Ok(v.text.clone()),
        PrimaryExpression::SimpleExpansion(v) => {
            Ok(source_slice(source, v.span.byte_start, v.span.byte_end))
        }
        PrimaryExpression::StringNode(v) => string_parts_text(&v.parts, source, nested),
        PrimaryExpression::TranslatedString(v) => string_parts_text(&v.parts, source, nested),
        PrimaryExpression::CommandSubstitution(v) => {
            nested.extend(v.body.clone());
            Ok(source_slice(source, v.span.byte_start, v.span.byte_end))
        }
        _ => Err("unsupported syntax: dynamic expansion".into()),
    }
}

fn command_name(
    name: &bash_ast::ast::CommandName,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    match &name.inner {
        CommandNameInner::Primary(v) => primary_text(v, source, nested),
        CommandNameInner::Concatenation(v) => v
            .parts
            .iter()
            .map(|p| primary_text(p, source, nested))
            .collect::<Result<Vec<_>, _>>()
            .map(|p| p.join("")),
    }
}

fn argument_range(argument: &CommandArgument) -> (usize, usize) {
    match argument {
        CommandArgument::Primary(v) => primary_range(v),
        CommandArgument::Concatenation(v) => (v.span.byte_start, v.span.byte_end),
        CommandArgument::Regex(v) => (v.span.byte_start, v.span.byte_end),
        CommandArgument::Operator { span, .. } => (span.byte_start, span.byte_end),
    }
}

fn argument_text(
    argument: &CommandArgument,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    match argument {
        CommandArgument::Primary(v) => primary_text(v, source, nested),
        CommandArgument::Concatenation(v) => v
            .parts
            .iter()
            .map(|p| primary_text(p, source, nested))
            .collect::<Result<Vec<_>, _>>()
            .map(|p| p.join("")),
        CommandArgument::Regex(v) => Ok(v.text.clone()),
        CommandArgument::Operator { text, .. } => Ok(text.clone()),
    }
}

fn assignment_target_text(target: &AssignmentTarget, source: &str) -> String {
    match target {
        AssignmentTarget::VariableName(v) => v.text.clone(),
        AssignmentTarget::Subscript(v) => source_slice(source, v.span.byte_start, v.span.byte_end),
    }
}

fn assignment_value_text(
    value: &AssignmentValue,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    match value {
        AssignmentValue::Primary(v) => primary_text(v, source, nested),
        AssignmentValue::Concatenation(v) => v
            .parts
            .iter()
            .map(|p| primary_text(p, source, nested))
            .collect::<Result<Vec<_>, _>>()
            .map(|p| p.join("")),
        _ => Err("unsupported syntax: assignment value".into()),
    }
}

fn assignment_text(
    assignment: &bash_ast::ast::VariableAssignment,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    Ok(format!(
        "{}={}",
        assignment_target_text(&assignment.name, source),
        assignment_value_text(&assignment.value, source, nested)?
    ))
}

fn declaration_part_start(part: &DeclarationPart) -> usize {
    match part {
        DeclarationPart::Word(v) => v.span.byte_start,
        DeclarationPart::VariableName(v) => v.span.byte_start,
        DeclarationPart::VariableAssignment(v) => v.span.byte_start,
    }
}

fn declaration_part_text(
    part: &DeclarationPart,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    match part {
        DeclarationPart::Word(v) => Ok(v.text.clone()),
        DeclarationPart::VariableName(v) => Ok(v.text.clone()),
        DeclarationPart::VariableAssignment(v) => assignment_text(v, source, nested),
    }
}

fn contains_process_substitution(primary: &PrimaryExpression) -> bool {
    match primary {
        PrimaryExpression::ProcessSubstitution(_) | PrimaryExpression::CommandSubstitution(_) => {
            true
        }
        PrimaryExpression::StringNode(value) => value
            .parts
            .iter()
            .any(|part| matches!(part, StringPart::CommandSubstitution(_))),
        PrimaryExpression::TranslatedString(value) => value
            .parts
            .iter()
            .any(|part| matches!(part, StringPart::CommandSubstitution(_))),
        _ => false,
    }
}

fn file_has_process_substitution(file: &bash_ast::ast::FileRedirect) -> bool {
    file.destinations
        .iter()
        .any(|destination| match destination {
            bash_ast::ast::RedirectDestination::Primary(primary) => {
                contains_process_substitution(primary)
            }
            bash_ast::ast::RedirectDestination::Concatenation(value) => {
                value.parts.iter().any(contains_process_substitution)
            }
        })
}

fn simple_redirect_has_process_substitution(redirect: &bash_ast::ast::SimpleRedirect) -> bool {
    matches!(redirect, bash_ast::ast::SimpleRedirect::File(file) if file_has_process_substitution(file))
}

fn redirect_has_process_substitution(redirect: &bash_ast::ast::Redirect) -> bool {
    matches!(redirect, bash_ast::ast::Redirect::File(file) if file_has_process_substitution(file))
}

fn simple_redirect_end(redirect: &SimpleRedirect) -> i64 {
    match redirect {
        SimpleRedirect::File(v) => v.span.byte_end as i64,
        SimpleRedirect::Herestring(v) => v.span.byte_end as i64,
    }
}

fn redirect_end(redirect: &Redirect) -> i64 {
    match redirect {
        Redirect::File(v) => v.span.byte_end as i64,
        Redirect::Herestring(v) => v.span.byte_end as i64,
        Redirect::Heredoc(v) => v
            .start
            .as_ref()
            .map(|start| start.span.byte_end as i64)
            .unwrap_or(v.span.byte_start as i64),
    }
}

fn parse_subcommands(command: &str) -> Result<Vec<ParsedSubcommand>, (String, String)> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(("parse_error".into(), "empty command".into()));
    }
    let offset = command.len() - command.trim_start().len();
    let program = parse_to_ast(trimmed).map_err(|e| ("parse_error".into(), e.to_string()))?;
    let mut subcommands = Vec::new();
    program
        .statements
        .iter()
        .try_for_each(|s| walk(s, trimmed, &mut subcommands))
        .map_err(|detail| ("unsupported_syntax".into(), detail))?;
    for command in &mut subcommands {
        command.start += offset as i64;
        command.end += offset as i64;
    }
    if subcommands.is_empty() {
        Err(("parse_error".into(), "no subcommands found".into()))
    } else {
        Ok(subcommands)
    }
}

fn maybe_bash_c_payload(args: &[(String, usize, usize)]) -> Option<(String, usize)> {
    args.iter()
        .position(|(text, _, _)| text == "-c")
        .and_then(|index| args.get(index + 1))
        .map(|(payload, start, _)| (payload.clone(), *start))
}

fn walk_command(
    command: &Command,
    source: &str,
    output: &mut Vec<ParsedSubcommand>,
) -> Result<Option<usize>, String> {
    if command
        .redirects
        .iter()
        .any(simple_redirect_has_process_substitution)
    {
        return Err("unsupported syntax: process substitution redirect".into());
    }

    let mut nested = Vec::new();
    let name = command_name(&command.name, source, &mut nested)?;
    let args = command
        .arguments
        .iter()
        .map(|argument| {
            let (start, end) = argument_range(argument);
            argument_text(argument, source, &mut nested).map(|text| (text, start, end))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if name == "bash" {
        if let Some((payload, payload_start)) = maybe_bash_c_payload(&args) {
            let mut inner = parse_subcommands(&payload).map_err(|(_, detail)| detail)?;
            for command in &mut inner {
                command.start += payload_start as i64;
                command.end += payload_start as i64;
            }
            output.extend(inner);
            return Ok(None);
        }
    }

    let span = command.span;
    let index = output.len();
    let args = args
        .into_iter()
        .map(|(text, _, _)| text)
        .collect::<Vec<_>>();
    output.push(ParsedSubcommand {
        normalized: std::iter::once(name.clone())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" "),
        start: span.byte_start as i64,
        end: span.byte_end as i64,
        command: name,
        args,
    });
    if let Some(subcommand) = output.get_mut(index) {
        for redirect in &command.redirects {
            subcommand.end = subcommand.end.max(simple_redirect_end(redirect));
        }
    }
    nested
        .iter()
        .try_for_each(|child| walk(child, source, output))?;
    Ok(Some(index))
}

fn walk_declaration(
    declaration: &bash_ast::ast::DeclarationCommand,
    source: &str,
    output: &mut Vec<ParsedSubcommand>,
) -> Result<(), String> {
    let keyword_end = declaration
        .parts
        .first()
        .map(declaration_part_start)
        .unwrap_or(declaration.span.byte_end);
    let keyword = source_slice(source, declaration.span.byte_start, keyword_end)
        .trim()
        .to_owned();
    let mut nested = Vec::new();
    let args = declaration
        .parts
        .iter()
        .map(|part| declaration_part_text(part, source, &mut nested))
        .collect::<Result<Vec<_>, _>>()?;
    output.push(ParsedSubcommand {
        normalized: std::iter::once(keyword.clone())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" "),
        start: declaration.span.byte_start as i64,
        end: declaration.span.byte_end as i64,
        command: keyword,
        args,
    });
    nested
        .iter()
        .try_for_each(|child| walk(child, source, output))
}

fn walk(
    statement: &Statement,
    source: &str,
    output: &mut Vec<ParsedSubcommand>,
) -> Result<(), String> {
    match statement {
        Statement::Command(command) => walk_command(command, source, output).map(|_| ()),
        Statement::Pipeline(v) => v
            .stages
            .iter()
            .try_for_each(|child| walk(child, source, output)),
        Statement::List(v) => {
            walk(&v.left, source, output)?;
            walk(&v.right, source, output)
        }
        Statement::CompoundStatement(CompoundStatement { statements, .. }) => statements
            .iter()
            .try_for_each(|child| walk(child, source, output)),
        Statement::Subshell(v) => v
            .statements
            .iter()
            .try_for_each(|child| walk(child, source, output)),
        Statement::Redirected(v) => {
            if v.redirects.iter().any(redirect_has_process_substitution) {
                return Err("unsupported syntax: process substitution redirect".into());
            }
            match v.body.as_deref() {
                Some(Statement::Command(command)) => {
                    if let Some(index) = walk_command(command, source, output)? {
                        if let Some(command) = output.get_mut(index) {
                            for redirect in &v.redirects {
                                command.end = command.end.max(redirect_end(redirect));
                            }
                        }
                    }
                    Ok(())
                }
                Some(body) => walk(body, source, output),
                None => Ok(()),
            }
        }
        Statement::Declaration(v) => walk_declaration(v, source, output),
        Statement::Negated(v) => walk(&v.inner, source, output),
        _ => Err("unsupported syntax: compound command".into()),
    }
}

pub fn parse(request: ParseRequest) -> ParseResponse {
    match parse_subcommands(&request.command) {
        Ok(subcommands) => response(request.nonce, true, "", "", subcommands),
        Err((reason, detail)) => response(request.nonce, false, &reason, &detail, Vec::new()),
    }
}

fn response(
    nonce: String,
    ok: bool,
    reason: &str,
    detail: &str,
    subcommands: Vec<ParsedSubcommand>,
) -> ParseResponse {
    ParseResponse {
        version: crate::CONTRACT_VERSION,
        operation: NativeOperation::Parse,
        ok,
        nonce,
        reason: reason.into(),
        detail: detail.into(),
        subcommands,
    }
}
