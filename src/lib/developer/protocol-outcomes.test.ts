import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEventLog, getAddress, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, parseAbiItem } from "viem";
import { deriveProtocolExpectation, SELECTORS } from "./protocol-outcomes.ts";

const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const FW = "0x694178a2396b54bff6a25caa0aa9cca6eb079441";
const USER = "0xB925D44d52815D19C2f91c30f6aBD3B4D0546D4E";
const TOKEN = "0x1111111111111111111111111111111111111111";
const abi = parseAbi([
  "function withdraw(uint256 wad)",
  "function transfer(address dst, uint256 wad) returns (bool)",
  "function approve(address guy, uint256 wad) returns (bool)",
  "function transferFrom(address src, address dst, uint256 wad) returns (bool)",
]);
const base = { caller: FW, wmon: WMON, value: 0n };

test("WMON deposit -> Deposit(caller, value)", () => {
  const r = deriveProtocolExpectation({ ...base, target: WMON, selector: SELECTORS.deposit, value: 10n ** 16n });
  assert.ok(r.ok);
  assert.equal(r.expectation.eventSignature, "Deposit(address,uint256)");
  assert.equal(r.expectation.conditions.arg1.value, "10000000000000000");
});

test("deposit on a non-WMON target is not judged", () => {
  assert.equal(deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.deposit }).ok, false);
});

test("WMON withdraw -> Withdrawal(caller, wad)", () => {
  const data = encodeFunctionData({ abi, functionName: "withdraw", args: [5n] });
  const r = deriveProtocolExpectation({ ...base, target: WMON, selector: SELECTORS.withdraw, data });
  assert.ok(r.ok);
  assert.equal(r.expectation.event, "Withdrawal");
  assert.equal(r.expectation.conditions.arg0.value.toLowerCase(), FW);
  assert.equal(r.expectation.conditions.arg1.value, "5");
  assert.equal(deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.withdraw, data }).ok, false);
});

test("any ERC-20 transfer -> Transfer(caller, dst, wad)", () => {
  const data = encodeFunctionData({ abi, functionName: "transfer", args: [USER, 7n] });
  const r = deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.transfer, data });
  assert.ok(r.ok);
  assert.deepEqual(Object.values(r.expectation.conditions).map((c) => c.value), [getAddress(FW), USER, "7"]);
});

test("any ERC-20 approve -> Approval(caller, guy, wad)", () => {
  const data = encodeFunctionData({ abi, functionName: "approve", args: [USER, 500000000000000n] });
  const r = deriveProtocolExpectation({ ...base, target: WMON, selector: SELECTORS.approve, data });
  assert.ok(r.ok);
  assert.equal(r.expectation.eventSignature, "Approval(address,address,uint256)");
  assert.equal(r.expectation.conditions.arg2.value, "500000000000000");
});

test("transferFrom -> Transfer(src, dst, wad)", () => {
  const data = encodeFunctionData({ abi, functionName: "transferFrom", args: [USER, TOKEN, 3n] });
  const r = deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.transferFrom, data });
  assert.ok(r.ok);
  assert.equal(r.expectation.conditions.arg0.value, USER);
});

test("selector mismatch and garbage calldata are refused", () => {
  const data = encodeFunctionData({ abi, functionName: "approve", args: [USER, 1n] });
  assert.equal(deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.transfer, data }).ok, false);
  assert.equal(deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.transfer, data: "0xdeadbeef" }).ok, false);
  assert.equal(deriveProtocolExpectation({ ...base, target: TOKEN, selector: SELECTORS.transfer }).ok, false);
});

test("expected Approval matches the real WETH9 log layout (src, guy indexed; wad data)", () => {
  const item = parseAbiItem("event Approval(address indexed src, address indexed guy, uint256 wad)");
  const topics = encodeEventTopics({ abi: [item], eventName: "Approval", args: { src: FW, guy: USER } });
  const log = decodeEventLog({ abi: [item], topics: topics as never, data: encodeAbiParameters([{ type: "uint256" }], [9n]) });
  const r = deriveProtocolExpectation({ ...base, target: WMON, selector: SELECTORS.approve, data: encodeFunctionData({ abi, functionName: "approve", args: [USER, 9n] }) });
  assert.ok(r.ok);
  assert.equal(String((log.args as { wad: bigint }).wad), r.expectation.conditions.arg2.value);
});
