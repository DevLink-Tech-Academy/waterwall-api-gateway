# Security Policy

We take the security of Waterwall seriously. Thank you for helping keep our users safe.

## Supported Versions

Only the latest minor release and the `main` branch receive security updates. Older releases are not patched — please upgrade before reporting issues against them.

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.** Public disclosure before a fix is available puts users at risk.

Instead, report privately through one of these channels:

1. **GitHub private advisory (preferred)** — open a report at https://github.com/DevLink-Tech-Academy/waterwall-api-gateway/security/advisories/new
2. **Email** — send details to the maintainer team (see `.github/FUNDING.yml` for the project owner, or contact the organization directly via GitHub)

When reporting, please include:

- A description of the issue and the component affected (service name, file, or endpoint)
- Steps to reproduce, or a minimal proof of concept
- The version or commit SHA you tested against
- Your assessment of the impact
- Any suggested remediation, if you have one

## Our Commitment

When you report an issue privately, we commit to:

- **Acknowledge** your report within **3 business days**
- **Provide an initial assessment** within **7 business days**
- **Keep you informed** of progress toward a fix
- **Credit you** in the release notes once the fix is public, unless you prefer to remain anonymous
- **Coordinate disclosure** with you — we will not publish details until a fix is available and users have had reasonable time to upgrade

## Scope

The following are in scope for reports:

- All backend services (`gateway-runtime`, `identity-service`, `management-api`, `analytics-service`, `notification-service`)
- Frontend portals (`gateway-portal`, `gateway-admin`)
- Shared libraries under `common/`
- Official Docker images and deployment scripts

The following are **out of scope**:

- Issues in third-party dependencies — please report those upstream (we will update once a fix is released)
- Social engineering, physical attacks, or denial-of-service through sheer volume of requests
- Missing best-practice headers on pages that do not handle sensitive data
- Findings from automated scanners without a demonstrated impact
- Issues affecting unsupported versions

## Safe Harbor

We consider security research conducted under this policy to be authorized, beneficial, and conducted in good faith. We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
- Only interact with accounts they own or have explicit permission to test
- Report issues promptly and do not exploit them beyond what is necessary to demonstrate the problem
- Give us reasonable time to respond before any public disclosure

Thank you for helping make Waterwall safer for everyone.
