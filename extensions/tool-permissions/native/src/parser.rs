use crate::contract::{NativeOperation, ParseRequest, ParseResponse, ParsedSubcommand};
use bash_ast::ast::{
    CommandArgument, CommandNameInner, CompoundStatement, PrimaryExpression, Statement,
};
use bash_ast::parse_to_ast;

fn primary_text(
    primary: &PrimaryExpression,
    source: &str,
    nested: &mut Vec<Statement>,
) -> Result<String, String> {
    match primary {
        PrimaryExpression::RawString(v) => Ok(v.text.clone()),
        PrimaryExpression::Word(v) => Ok(v.text.clone()),
        PrimaryExpression::AnsiCString(v) => Ok(v.text.clone()),
        PrimaryExpression::BraceExpression(v) => Ok(v.text.clone()),
        PrimaryExpression::Number(v) => Ok(v.text.clone()),
        PrimaryExpression::StringNode(v) => v
            .parts
            .iter()
            .map(|part| match part {
                bash_ast::ast::StringPart::Content(v) => Ok(v.text.clone()),
                bash_ast::ast::StringPart::Raw { text, .. } => Ok(text.clone()),
                bash_ast::ast::StringPart::CommandSubstitution(v) => {
                    nested.extend(v.body.clone());
                    Ok(source[v.span.byte_start..v.span.byte_end].to_owned())
                }
                _ => Err("unsupported syntax: dynamic expansion".into()),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|parts| parts.join("")),
        PrimaryExpression::CommandSubstitution(v) => {
            nested.extend(v.body.clone());
            Ok(source[v.span.byte_start..v.span.byte_end].to_owned())
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

fn contains_process_substitution(primary: &PrimaryExpression) -> bool {
    match primary {
        PrimaryExpression::ProcessSubstitution(_) | PrimaryExpression::CommandSubstitution(_) => {
            true
        }
        PrimaryExpression::StringNode(value) => value
            .parts
            .iter()
            .any(|part| matches!(part, bash_ast::ast::StringPart::CommandSubstitution(_))),
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

fn walk(
    statement: &Statement,
    source: &str,
    output: &mut Vec<ParsedSubcommand>,
) -> Result<(), String> {
    match statement {
        Statement::Command(command) => {
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
                .map(|argument| match argument {
                    CommandArgument::Primary(v) => primary_text(v, source, &mut nested),
                    CommandArgument::Concatenation(v) => v
                        .parts
                        .iter()
                        .map(|p| primary_text(p, source, &mut nested))
                        .collect::<Result<Vec<_>, _>>()
                        .map(|p| p.join("")),
                    CommandArgument::Regex(v) => Ok(v.text.clone()),
                    CommandArgument::Operator { text, .. } => Ok(text.clone()),
                })
                .collect::<Result<Vec<_>, _>>()?;
            let span = command.span;
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
            nested
                .iter()
                .try_for_each(|child| walk(child, source, output))
        }
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
            let first = output.len();
            v.body
                .as_deref()
                .map(|body| walk(body, source, output))
                .unwrap_or(Ok(()))?;
            if let Some(command) = output.get_mut(first) {
                command.start = v.span.byte_start as i64;
                command.end = v.span.byte_end as i64;
            }
            Ok(())
        }
        _ => Err("unsupported syntax: compound command".into()),
    }
}

pub fn parse(request: ParseRequest) -> ParseResponse {
    let trimmed = request.command.trim();
    if trimmed.is_empty() {
        return response(
            request.nonce,
            false,
            "parse_error",
            "empty command",
            Vec::new(),
        );
    }
    let offset = request.command.len() - request.command.trim_start().len();
    let program = match parse_to_ast(trimmed) {
        Ok(v) => v,
        Err(e) => {
            return response(
                request.nonce,
                false,
                "parse_error",
                &e.to_string(),
                Vec::new(),
            )
        }
    };
    let mut subcommands = Vec::new();
    if let Err(detail) = program
        .statements
        .iter()
        .try_for_each(|s| walk(s, trimmed, &mut subcommands))
    {
        return response(
            request.nonce,
            false,
            "unsupported_syntax",
            &detail,
            Vec::new(),
        );
    }
    for command in &mut subcommands {
        command.start += offset as i64;
        command.end += offset as i64;
    }
    let ok = !subcommands.is_empty();
    response(
        request.nonce,
        ok,
        if ok { "" } else { "parse_error" },
        if ok { "" } else { "no subcommands found" },
        subcommands,
    )
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
