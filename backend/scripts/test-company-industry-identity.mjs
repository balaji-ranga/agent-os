/**
 * Unit checks: industry label must not fall through to Restaurant for general_ops.
 * Run: node scripts/test-company-industry-identity.mjs
 */
import {
  resolveCompanyIndustryIdentity,
  resolveCompanyTypeId,
} from '../src/services/company-blueprints/index.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

// Education card → label Education, pack general_ops
const edu = resolveCompanyIndustryIdentity({ company_type_card: 'education' });
assert(edu.company_type_label === 'Education', 'education label: ' + edu.company_type_label);
assert(edu.company_type === 'general_ops', 'education maps to general_ops pack');
assert(edu.company_type_card === 'education', 'education card id');

// Only company_type=general_ops, no card → Consultation / General ops, NOT Restaurant
const thin = resolveCompanyIndustryIdentity({ company_type: 'general_ops' });
assert(
  !/restaurant/i.test(thin.company_type_label),
  'must not show Restaurant for bare general_ops: ' + thin.company_type_label
);

// company_type string education (legacy store)
const edu2 = resolveCompanyIndustryIdentity({ company_type: 'education' });
assert(edu2.company_type_label === 'Education', 'education as company_type');

// Memory-only Education
const mem = resolveCompanyIndustryIdentity({}, { memoryIndustry: 'education' });
assert(mem.company_type_label === 'Education', 'memory industry');

// Label from company_memory style "Education"
const memL = resolveCompanyIndustryIdentity({}, { memoryIndustry: 'Education' });
assert(memL.company_type_label === 'Education', 'memory label match');

assert(resolveCompanyTypeId('education') === 'general_ops', 'resolve');

console.log('ok', {
  edu: edu.company_type_label,
  bare: thin.company_type_label,
  mem: mem.company_type_label,
});
