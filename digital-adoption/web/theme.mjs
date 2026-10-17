const defaults = Object.freeze({background:'#ffffff',foreground:'#18243c',surface:'#f3f5fa',primary:'#3459cf',onPrimary:'#ffffff',muted:'#526078',border:'#d5dcea',radius:16,fontSize:14,font:'system',position:'bottom-right',offset:20,width:420,height:680,title:'Digital Adoption Copilot'});
const colors = ['background','foreground','surface','primary','onPrimary','muted','border'];
export function normalizeTheme(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid theme');
  const result = {...defaults};
  for (const [key,value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults,key)) throw new Error(`Unknown theme setting: ${key}`);
    if (colors.includes(key)) {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid color: ${key}`);
    } else if (['radius','fontSize','offset','width','height'].includes(key)) {
      const limits = {radius:[0,28],fontSize:[14,20],offset:[8,64],width:[300,520],height:[400,800]}[key];
      if (!Number.isInteger(value) || value < limits[0] || value > limits[1]) throw new Error(`Invalid dimension: ${key}`);
    } else if (key === 'position' && !['bottom-right','bottom-left','top-right','top-left'].includes(value)) throw new Error('Invalid position');
    else if (key === 'font' && !['system','serif','mono'].includes(value)) throw new Error('Invalid font');
    else if (key === 'title' && (typeof value !== 'string' || !value.trim() || value.length > 64 || /[\x00-\x1f]/.test(value))) throw new Error('Invalid title');
    result[key] = value;
  }
  return result;
}
export function themeProperties(input) {
  const theme = normalizeTheme(input);
  return {...Object.fromEntries(colors.map(key => [`--adoption-${key}`,theme[key]])),
    '--adoption-radius':`${theme.radius}px`,'--adoption-font-size':`${theme.fontSize}px`,
    '--adoption-font':{system:'system-ui, sans-serif',serif:'Georgia, serif',mono:'ui-monospace, monospace'}[theme.font]};
}
