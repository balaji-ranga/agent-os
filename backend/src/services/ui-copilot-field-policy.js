// Shared by model metadata and execution validation: guidance is not authority.
export function isCopilotFillableField(field) {
  return !!field && !field.user_only && !field.readonly && ['text','search','email','url','tel','number','textarea','select'].includes(field.type)
    && !/Unlabelled|dynamically labelled|password|secret|token|credential|permission|grant|mfa|otp|payment|credit.?card|bank|budget|authority|retention|delete|purge|\bscript\b|\bcode\b|javascript|webhook|callback/i.test(field.label)
    && !/ApiKeys|Policies|IpWhitelist|Token|RiskClassification|CustomScript|Workflow|AgentWorkspace|EfficiencyControls|Admin/i.test(field.id);
}
