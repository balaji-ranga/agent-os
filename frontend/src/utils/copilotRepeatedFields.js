import contracts from '../copilot/repeated-field-contracts.json';

// Source-authored contracts only; unknown dynamic fields have no identity.
export function repeatedCopilotField(source,group,key){
  const groups=Object.hasOwn(contracts,source)?contracts[source]:null;
  const fields=groups&&Object.hasOwn(groups,group)?groups[group]:null;
  const field=fields&&Object.hasOwn(fields,key)?fields[key]:null;
  return field?{'data-copilot-control':`${source}#${group}.${key}`,'aria-label':field.label}:{};
}
