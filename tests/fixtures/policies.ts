export const samplePolicies = {
  allowAll: `
version: "1.0"
name: "Allow All Policy"
defaultAction: ALLOW
rules: []
`,

  blockAll: `
version: "1.0"
name: "Block All Policy"
defaultAction: BLOCK
rules: []
`,

  requireApprovalAll: `
version: "1.0"
name: "Require Approval Policy"
defaultAction: REQUIRE_HUMAN_APPROVAL
webhook:
  url: "https://example.com/webhook"
  timeout: 5000
rules: []
`,

  complexPolicy: `
version: "1.0"
name: "Complex Security Policy"
defaultAction: BLOCK
webhook:
  url: "https://example.com/webhook"
  timeout: 10000
  retries: 3

rules:
  - name: "Allow read operations"
    priority: 100
    action: ALLOW
    conditions:
      - field: "toolCall.toolName"
        operator: "in"
        value: ["read", "list", "get"]

  - name: "Block delete operations"
    priority: 200
    action: BLOCK
    conditions:
      - field: "toolCall.toolName"
        operator: "contains"
        value: "delete"

  - name: "Require approval for financial operations"
    priority: 150
    action: REQUIRE_HUMAN_APPROVAL
    conditions:
      - field: "toolCall.parameters.category"
        operator: "equals"
        value: "financial"

  - name: "Large amount approval"
    priority: 140
    action: REQUIRE_HUMAN_APPROVAL
    conditions:
      - field: "toolCall.parameters.amount"
        operator: "gt"
        value: 1000
`,

  invalidPolicy: `
version: "1.0"
name: "Invalid Policy"
# Missing defaultAction
rules: []
`,
};
