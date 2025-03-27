export default {
  '*.(json|md|ts|mjs)': 'prettier --write',
  '*.(ts|mjs)': 'eslint --max-warnings 0 .',
  '*.ts': () =>
    'esbuild index.ts --bundle --packages=external --outfile=index.js --platform=node --format=esm --tree-shaking=true',
}
