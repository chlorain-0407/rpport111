import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePastedListingTextDeterministic, parsePacificRenderedListing } from '../src/server/portalParsers';
import { calculatePropertyCompleteness, resolvePropertyFieldStatus } from '../src/utils/calculator';
import { sanitizeGeneratedAdvice } from '../src/server/reportAdvice';
import { mapPacificPublicListing, readPacificPublicListing } from '../src/server/pacificPublicListing';

test('management fees ending in zero stay positive, with the correct period', () => {
  for (const [raw, amount, monthly] of [
    ['每月1800元', 1800, 1800], ['6000元/季', 6000, 2000], ['3509元/月', 3509, 3509],
    ['5582元/半年', 5582, 930], ['0元/月', 0, 0], ['無', 0, 0], ['免管理費', 0, 0],
  ] as const) {
    const result = parsePastedListingTextDeterministic('管理費：' + raw);
    assert.equal(result.parsedFields.managementFeeAmount, amount, raw);
    assert.ok(Math.abs(result.parsedFields.managementFee - monthly) < 0.01, raw);
  }
  assert.equal(parsePastedListingTextDeterministic('管理費待確認').parsedFields.managementFeeAmount, undefined);
  assert.equal(parsePastedListingTextDeterministic('管理費：1800元').parsedFields.managementFee, null);
});

test('badges and completeness share statuses and cannot count empty recorded values as complete', () => {
  const property: any = { cityDistrict: '新竹縣竹北市', askingPrice: null, hasParking: false,
    fieldStatus: { askingPrice: 'recorded', layout: 'verified' }, layout: '3房' };
  const checklist = calculatePropertyCompleteness(property);
  for (const field of [...checklist.coreFields, ...checklist.advancedFields]) {
    assert.equal(field.status, resolvePropertyFieldStatus(property, field.key));
  }
  assert.equal(resolvePropertyFieldStatus(property, 'cityDistrict'), 'recorded');
  assert.equal(resolvePropertyFieldStatus(property, 'askingPrice'), 'pending');
  assert.equal(resolvePropertyFieldStatus(property, 'layout'), 'pending');
  assert.equal(resolvePropertyFieldStatus(property, 'parkingType'), 'not_applicable');
});

test('AI service promises become advice in reports and regenerated sections', () => {
  const result = sanitizeGeneratedAdvice({ summary:'顧問將於48小時內提供3-5筆案例。',
    sections:[{contentMarkdown:'建議查閱成交案例。\n顧問將於48小時內協助搜尋並提供3-5筆區域相似案例供參考。'}],
    proposedContent:'我們會在兩天內完成。' });
  assert.doesNotMatch(JSON.stringify(result), /48小時|3-5筆|兩天/);
  assert.match(result.sections[0].contentMarkdown, /建議查閱成交案例/);
});

const listing = { idx:123, saleID:'S1234567', objectName:'QA虛構公寓', hasSellAndRent:1, objectCate:2,
  company:'SI', totalArea:29.8, mainBuildArea:29.8, outbuildingArea:0, pubFacilityArea:0,
  ownerStallArea:0, pubStallArea:0, sellTotalPrice:1980, firstSellTotalPrice:2298,
  address:'臺北市中正區模擬路段', attributName:'公寓', layoutRoom:3, layoutHall:2, layoutToilet:2,
  onWhichFloor:'3', buildingAboveFloor:4, objectAge:'54年9個月', hasStall:2,
  adminFee:1800, payAdminFeeTypeName:'月繳', saleEmployeePhone:'DO_NOT_IMPORT' };

test('Pacific maps only matching public sale specs without guessing zero areas', () => {
  const result = mapPacificPublicListing(listing, 'S1234567');
  assert.equal(result.status,'ok');
  if (result.status !== 'ok') return;
  const parsed = parsePacificRenderedListing({sourcePlatform:'太平洋房屋',sourceListingId:'S1234567'} as any,result.visible)!;
  assert.equal(parsed.parsedFields.askingPrice,1980);
  assert.equal(parsed.parsedFields.previousAskingPrice,2298);
  assert.equal(parsed.parsedFields.totalArea,29.8);
  assert.equal(parsed.parsedFields.managementFeeAmount,1800);
  assert.equal(parsed.parsedFields.age,54.75);
  assert.equal(parsed.parsedFields.hasParking,false);
  assert.equal(parsed.parsedFields.auxArea,undefined);
  assert.doesNotMatch(JSON.stringify(result),/DO_NOT_IMPORT/);
  assert.equal(mapPacificPublicListing(listing,'S9999999').status,'unavailable');
  assert.equal(mapPacificPublicListing({...listing,hasSellAndRent:2},'S1234567').status,'unavailable');
  assert.equal(mapPacificPublicListing({idx:0,saleID:null,objectName:null},'S1234567').status,'not_found');
  const whole = mapPacificPublicListing({...listing,attributName:'透天',onWhichFloor:'0'},'S1234567');
  assert.equal(whole.status,'ok');
  if (whole.status === 'ok') {
    const parsedWhole = parsePastedListingTextDeterministic(whole.visible.specifications);
    assert.equal(parsedWhole.parsedFields.propertyType,'透天別墅');
    assert.equal(parsedWhole.parsedFields.totalFloors,'4');
  }
});

test('Pacific square metre conversion uses the official PRMS total before rounding', () => {
  const result = mapPacificPublicListing({...listing,company:'PRMS',mainBuildArea:100,outbuildingArea:10,
    pubFacilityArea:20,pubStallArea:0,ownerStallArea:0},'S1234567');
  assert.equal(result.status,'ok');
  if (result.status === 'ok') assert.match(result.visible.specifications,/權狀總坪數：39.32坪/);
});

test('Pacific requests use only the fixed public endpoint and bound response size', async () => {
  const html = '<base id="baseAuthorization" href="public-test-header">';
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(String(url),'https://www.pacific.com.tw/api/ObjectAPI/GetObjectDetail/S1234567');
    assert.equal(options?.redirect,'error');
    assert.deepEqual(options?.headers,{Accept:'application/json',Authorization:'public-test-header'});
    return new Response(JSON.stringify(listing),{headers:{'content-type':'application/json'}});
  };
  assert.equal((await readPacificPublicListing('S1234567',html,new AbortController().signal,request)).status,'ok');
  assert.equal((await readPacificPublicListing('../private',html,new AbortController().signal,request)).status,'unavailable');
  assert.equal(calls,1);
  const oversized: typeof fetch = async () => new Response(' '.repeat(512001),{headers:{'content-type':'application/json'}});
  assert.equal((await readPacificPublicListing('S1234567',html,new AbortController().signal,oversized)).status,'unavailable');
});

