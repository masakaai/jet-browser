// WebDriver async script. This runs only inside the assigned page, never Node/Rust.
const expression = arguments[0], done = arguments[arguments.length - 1];
const failure = error => {
  let description = String(error?.message || error).slice(0, 2000);
  if (error?.name === 'SyntaxError' && /return/i.test(description)) description = 'Illegal return statement';
  done({ result: { type: 'object', subtype: 'error', description }, exceptionDetails: { text: description } });
};
Promise.resolve().then(() => (0, eval)(expression)).then(value => {
  try {
    const type = typeof value;
    if (type === 'bigint' || (type === 'number' && !Number.isFinite(value))) throw new Error('Evaluation result must be JSON serializable');
    if (type === 'undefined' || type === 'function' || type === 'symbol') { done({ result: { type } }); return; }
    const encoded = JSON.stringify(value);
    if (encoded.length > 64000) throw new Error('Evaluation result exceeds 64000 characters; extract fewer fields');
    done({ result: { type, ...(value === null ? { subtype: 'null' } : {}), value: JSON.parse(encoded) } });
  } catch (error) { failure(error); }
}, failure);
