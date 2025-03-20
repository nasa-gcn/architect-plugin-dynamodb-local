export default {
  '*.(json|md|ts|mjs)': 'prettier --write',
  '*.(ts|mjs)': 'eslint --max-warnings 0 .',
  '*.ts': () => 'tsc',
}
