import { rcedit } from 'rcedit';
const [exe, icon, version] = process.argv.slice(2);
await rcedit(exe, {
  icon,
  'file-version': version.split('-')[0],
  'product-version': version.split('-')[0],
  'version-string': { ProductName: 'translationCore4', FileDescription: 'translationCore4', CompanyName: 'unfoldingWord' },
});
