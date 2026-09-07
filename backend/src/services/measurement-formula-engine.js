const FUNCTIONS = new Set(['sum', 'avg', 'count', 'latest', 'min', 'max', 'now']);

function tokenize(expression) {
  const tokens = [];
  const source = String(expression || '');
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); index += number[0].length; continue; }
    const identifier = rest.match(/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/);
    if (identifier) { tokens.push({ type: 'identifier', value: identifier[0] }); index += identifier[0].length; continue; }
    if ('+-*/(),'.includes(source[index])) { tokens.push({ type: source[index], value: source[index] }); index += 1; continue; }
    throw new Error(`Unsupported formula token near: ${rest.slice(0, 20)}`);
  }
  return tokens;
}

function parse(expression) {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const take = (type) => {
    const token = tokens[position];
    if (!token || token.type !== type) throw new Error(`Expected ${type}`);
    position += 1;
    return token;
  };
  const primary = () => {
    if (peek()?.type === 'number') return { type: 'number', value: take('number').value };
    if (peek()?.type === '-') { take('-'); return { type: 'unary', value: primary() }; }
    if (peek()?.type === '(') { take('('); const value = additive(); take(')'); return value; }
    const name = take('identifier').value;
    if (peek()?.type !== '(') return { type: 'attribute', name };
    if (!FUNCTIONS.has(name)) throw new Error(`Unsupported formula function: ${name}`);
    take('(');
    const args = [];
    if (peek()?.type !== ')') {
      do { args.push(additive()); if (peek()?.type !== ',') break; take(','); } while (true);
    }
    take(')');
    return { type: 'call', name, args };
  };
  const multiplicative = () => {
    let node = primary();
    while (peek() && ['*', '/'].includes(peek().type)) { const operator = tokens[position++].type; node = { type: 'binary', operator, left: node, right: primary() }; }
    return node;
  };
  const additive = () => {
    let node = multiplicative();
    while (peek() && ['+', '-'].includes(peek().type)) { const operator = tokens[position++].type; node = { type: 'binary', operator, left: node, right: multiplicative() }; }
    return node;
  };
  const ast = additive();
  if (position !== tokens.length) throw new Error('Unexpected formula input');
  return ast;
}

function pathValues(value, path) {
  let values = [value];
  for (const segment of String(path || '').split('.').filter(Boolean)) {
    const array = segment.endsWith('[]');
    const key = array ? segment.slice(0, -2) : segment;
    values = values.flatMap((item) => {
      const next = item == null ? undefined : item[key];
      return array && Array.isArray(next) ? next : [next];
    }).filter((item) => item !== undefined && item !== null);
  }
  return values;
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function applyBinary(operator, left, right) {
  if (operator === '+') return numeric(left) + numeric(right);
  if (operator === '-') return numeric(left) - numeric(right);
  if (operator === '*') return numeric(left) * numeric(right);
  if (operator === '/') return numeric(right) === 0 ? 0 : numeric(left) / numeric(right);
  throw new Error(`Unsupported operator: ${operator}`);
}

function evaluator(ast, records, attributes, row = null) {
  if (ast.type === 'number') return ast.value;
  if (ast.type === 'unary') return -numeric(evaluator(ast.value, records, attributes, row));
  if (ast.type === 'binary') return applyBinary(ast.operator, evaluator(ast.left, records, attributes, row), evaluator(ast.right, records, attributes, row));
  if (ast.type === 'attribute') {
    const attribute = attributes.get(ast.name);
    if (!attribute) throw new Error(`Unsupported formula attribute: ${ast.name}`);
    const target = row || records.at(-1) || {};
    if (Object.hasOwn(target, ast.name)) return target[ast.name];
    const values = pathValues(target, attribute.path || ast.name);
    const scaled = Number.isFinite(attribute.scale) ? values.map((value) => numeric(value) * attribute.scale) : values;
    return scaled.length > 1 ? scaled : scaled[0];
  }
  if (ast.type !== 'call') throw new Error('Invalid formula expression');
  if (ast.name === 'now') return Date.now();
  if (!ast.args.length) throw new Error(`${ast.name} requires an attribute or expression`);
  if (ast.name === 'latest') {
    const sorted = ast.args[1]
      ? [...records].sort((a, b) => numeric(evaluator(ast.args[1], records, attributes, a)) - numeric(evaluator(ast.args[1], records, attributes, b)))
      : records;
    return sorted.length ? evaluator(ast.args[0], records, attributes, sorted.at(-1)) : 0;
  }
  const values = records.flatMap((record) => {
    const value = evaluator(ast.args[0], records, attributes, record);
    return Array.isArray(value) ? value : [value];
  }).filter((value) => value !== undefined && value !== null && value !== '');
  if (ast.name === 'count') return new Set(values.map((value) => typeof value === 'object' ? JSON.stringify(value) : String(value))).size;
  const numbers = values.map(numeric);
  if (!numbers.length) return 0;
  if (ast.name === 'sum') return numbers.reduce((total, value) => total + value, 0);
  if (ast.name === 'avg') return numbers.reduce((total, value) => total + value, 0) / numbers.length;
  if (ast.name === 'min') return Math.min(...numbers);
  if (ast.name === 'max') return Math.max(...numbers);
  throw new Error(`Unsupported formula function: ${ast.name}`);
}

/** Execute the validated declarative formula against normalized or provider-native records. */
export function executeFormula({ expression, records = [], attributes = [] }) {
  if (!Array.isArray(records)) throw new Error('Formula records must be an array');
  const attributeMap = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const result = evaluator(parse(expression), records, attributeMap);
  if (!Number.isFinite(Number(result))) throw new Error('Formula result is not numeric');
  return Math.round(Number(result) * 10000) / 10000;
}
