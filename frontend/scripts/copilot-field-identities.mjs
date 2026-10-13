// Stable source-inventory identities, not an autofill permission. Values never
// enter these attributes. This Babel hook covers native controls on every page.
export default function copilotFieldIdentities({types:t}) {
  return {visitor:{JSXOpeningElement(path,state){
    const node=path.node;
    if(!['input','textarea','select'].includes(node.name?.name))return;
    const filename=String(state.file.opts.filename||'').replaceAll('\\','/');
    const source=filename.split('/src/')[1];
    if(!source||!/^(pages|components)\//.test(source)||source.includes('PlatformHelpCopilot'))return;
    if(node.attributes.some(a=>a.name?.name==='data-copilot-control'))return;
    node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-copilot-control'),t.stringLiteral(`${source}:${node.loc.start.line}`)));
  }}};
}
