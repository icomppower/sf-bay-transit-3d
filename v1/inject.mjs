// Inject data.json into index.template.html -> index.html
import fs from 'fs';
const tpl = fs.readFileSync('index.template.html', 'utf8');
const data = fs.readFileSync('data.json', 'utf8');
const out = tpl.replace('/*__DATA__*/ null', data);
fs.writeFileSync('index.html', out);
console.log(`index.html: ${(fs.statSync('index.html').size / 1024).toFixed(0)} KB`);
