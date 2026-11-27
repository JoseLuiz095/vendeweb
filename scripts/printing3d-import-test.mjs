import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';
const compile=async(file)=>{const source=readFileSync(file,'utf8').replace("'three/examples/jsm/libs/fflate.module.js'",JSON.stringify(pathToFileURL(new URL('../node_modules/three/examples/jsm/libs/fflate.module.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')).href));return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));};
const parser=await compile('src/modules/printImport.ts');
const {calculatePrintPrice,printProfit,defaultPrintCosts}=await compile('src/modules/calculator.ts');
const xml='<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="7200"/><metadata key="weight" value="30"/><metadata key="printer_model_id" value="A1"/><object name="Peça &amp; suporte"/><filament id="1" type="PLA" color="#FFFFFF" used_g="20"/><filament id="2" type="PETG" color="#112233" used_g="10"/></plate><plate><metadata key="index" value="2"/><metadata key="prediction" value="1800"/></plate></config>';
test('sliced 3MF preserves separate plates, material colors and estimates',async()=>{
  const bytes=zipSync({'Metadata/slice_info.config':strToU8(xml),'Metadata/plate_1.gcode':strToU8('M112 DO NOT EXECUTE')});
  const result=await parser.importPrintFile(new File([bytes],'sample.gcode.3mf'));
  assert.equal(result.plates.length,2);assert.equal(result.plates[0].hours,2);assert.equal(result.plates[0].filaments[1].grams,10);assert.equal(result.plates[0].name,'Peça & suporte');assert.equal(result.plates[1].grams,null);assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal((await parser.importPrintFile(new File([bytes],'renamed.3mf'))).sha256,result.sha256);
});
test('unfatiated 3MF, malformed zip, XML entities and unsafe metadata fail explicitly',async()=>{
  await assert.rejects(()=>parser.importPrintFile(new File([zipSync({'3D/model.model':strToU8('model')})],'project.3mf')),/fatiamento/);
  assert.throws(()=>parser.sliceInfoFromZip(new Uint8Array(50)));
  assert.throws(()=>parser.parseSliceInfo('<!DOCTYPE config><plate></plate>'),/XML/);
  assert.throws(()=>parser.parseSliceInfo('<plate index="1"></plate><plate index="1"></plate>'));
  const bomb=zipSync({'Metadata/slice_info.config':new Uint8Array(3*1024*1024)});
  assert.throws(()=>parser.sliceInfoFromZip(bomb),/limites/);
});
test('G-code metadata accepts Bambu/Orca forms and never treats absent weight as real zero',()=>{
  const plate=parser.parseGcode('; model printing time: 1h 30m 0s; total estimated time\n; total filament weight [g] : 24.50\n; printer_model = Bambu Lab A1\nM104 S200');
  assert.equal(plate.hours,1.5);assert.equal(plate.grams,24.5);assert.equal(plate.printer,'Bambu Lab A1');
  assert.equal(parser.parseGcode('; estimated printing time (normal mode) = 2m').grams,null);
  assert.throws(()=>parser.parseGcode('G1 X20 Y30'));
});
test('legacy costs remain compatible; expanded calculation includes costs and excludes fees from profit',()=>{
  assert.equal(calculatePrintPrice(defaultPrintCosts).baseCents,1280);assert.equal(calculatePrintPrice(defaultPrintCosts).suggestedCents,1829);
  const costs={grams:100,cents_per_gram:10,watts:100,energy_cents_kwh:100,hours:2,machine_cents_hour:200,labor_cents:300,finishing_cents:100,loss_bps:1000,packaging_cents:200,other_cents:100,fixed_fee_cents:50,payment_fee_bps:500,tax_bps:500,margin_bps:3000};
  assert.equal(calculatePrintPrice(costs).baseCents,2312);assert.equal(calculatePrintPrice(costs).suggestedCents,3853);
  assert.equal(printProfit(costs,5000).profitCents,2188);assert.equal(printProfit(costs,1000).profitCents,-1412);
  assert.throws(()=>calculatePrintPrice({...costs,margin_bps:9000}));assert.throws(()=>calculatePrintPrice({...costs,loss_bps:10001}));assert.throws(()=>calculatePrintPrice({...costs,grams:NaN}));
});
