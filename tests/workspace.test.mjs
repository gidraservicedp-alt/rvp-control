import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkItems,
  isAttentionItem,
  kyivDay,
} from "../src/workspace/workflow.ts";
import {
  readRoute,
  routeSearch,
  navigationGroups,
} from "../src/workspace/navigation.ts";
const now = new Date("2026-11-14T12:00:00Z");
const app = (id, fields = {}) => ({
  id,
  status: "В роботі",
  contractorId: "c1",
  payoutStatus: "Очікує",
  payoutAmount: 0,
  ...fields,
});
const act = (id, application_id, status, created_at) => ({
  id,
  application_id,
  status,
  created_at,
});
test("Each order has one next action; newest submitted result wins over old rejection", () => {
  const rows = buildWorkItems(
    [app("a", { awaitingAct: true })],
    [
      act("old", "a", "rejected", "2026-11-10"),
      act("new", "a", "pending", "2026-11-13"),
    ],
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].queue, "review");
  assert.equal(rows[0].actId, "new");
});
test("Cancelled and paid jobs cannot reappear as overdue work; closed jobs without a price remain visible for settlement", () => {
  const rows = buildWorkItems(
    [
      app("cancelled", { status: "Скасована", hasProblem: true }),
      app("paid", {
        status: "Виконана",
        payoutStatus: "Виплачено",
        payoutAmount: 100,
        hasProblem: true,
      }),
      app("zero", { status: "Виконана" }),
      app("pending", { status: "Виконана", payoutAmount: 100 }),
    ],
    [],
    now,
  );
  assert.deepEqual(
    rows.map((r) => r.app.id),
    ["pending", "zero"],
  );
  assert.equal(rows[0].queue, "payout");
  assert.match(rows.find(r=>r.app.id==="zero").reason, /суму ще не вказано/);
  assert.equal(rows[0].urgent, false);
});
test("Problems and overdue orders precede normal dispatch, without duplicating a record", () => {
  const rows = buildWorkItems(
    [
      app("normal", { contractorId: "" }),
      app("late", { deadline: "2026-11-13" }),
      app("problem", { hasProblem: true, deadline: "2026-11-12" }),
    ],
    [],
    now,
  );
  assert.deepEqual(
    rows.map((r) => r.app.id),
    ["problem", "late", "normal"],
  );
  assert.ok(rows.every(isAttentionItem));
});
test("Waiting for an act is different from an act submitted for approval", () => {
  const rows = buildWorkItems([app("waiting", { awaitingAct: true })], [], now);
  assert.equal(rows[0].queue, "review");
  assert.equal(rows[0].actId, undefined);
  assert.equal(rows[0].action, "Відкрити виконання");
});
test("Normal execution stays out of attention, while offered work stays visible", () => {
  const rows = buildWorkItems(
    [
      app("active", { contractorStage: "departed" }),
      app("offered", { contractorStage: "offered" }),
    ],
    [],
    now,
  );
  assert.deepEqual(
    rows.filter(isAttentionItem).map((r) => r.app.id),
    ["offered"],
  );
});
test("Calendar summary uses Kyiv midnight, independent of browser timezone", () => {
  assert.equal(kyivDay("2026-11-14T22:30:00Z"), "2026-11-15");
  assert.equal(kyivDay("bad"), "");
});
test("Object context and open application survive URL round trip; unknown pages fail to overview", () => {
  const route = {
    page: "objects",
    site: "s-1",
    application: "a-2",
    network: "WOG",
  };
  assert.deepEqual(readRoute(routeSearch(route)), {
    ...route,
    record: undefined,
    region: undefined,
    month: undefined,
  });
  const report = { page:'rpv-reports', network:'WOG', region:'UA12', month:'2026-10', site:'s-1' };
  assert.deepEqual(readRoute(routeSearch(report)),{...report,application:undefined,record:undefined});
  assert.equal(readRoute("?page=unknown").page, "today");
  const ids = navigationGroups.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
});
