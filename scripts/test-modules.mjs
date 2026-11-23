try {
  await import('./modules-unit-test.mjs');
  await import('./modules-edge-test.mjs');
  await (await import('./modules-db-test.mjs')).runModulesDbTests();
} catch (error) {
  console.error('Falha nos testes de módulos:', error.message);
  if (error.where) console.error(error.where);
  process.exit(1);
}
