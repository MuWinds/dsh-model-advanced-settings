/**
 * Regression tests for the browser half of the plugin.
 *
 * The page is mounted through `test/harness.mjs`, which renders it with a React
 * hook shim, and the assertions read the resulting element tree plus the save
 * payload the page POSTs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountClient, byClass, walk, textOf } from "./harness.mjs";

/** Mount, settle the load, and return the tree with its helpers. */
async function ready(options) {
  const client = mountClient(options);
  const tree = await client.settle();
  return { ...client, tree };
}

/** The page's primary save button, which the levels block owns. */
function saveButton(tree) {
  const button = walk(tree).find((n) => n.type === "button" && n.className === "dsw-mas-btn");
  assert.ok(button, "the page has a save button");
  return button;
}

/** Press the page's primary save button and flush the request. */
async function pressSave(render) {
  saveButton(render()).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The one DeveloperRole select, which the provider-level block owns. */
function developerRoleSelect(tree) {
  const selects = byClass(tree, "dsw-mas-compat");
  assert.equal(selects.length, 1, "one provider-level DeveloperRole select");
  return selects[0];
}

/** The subagent provider select: the first one offering the "inherit" option. */
function subagentProviderSelect(tree) {
  const selects = byClass(tree, "dsw-mas-select").filter((n) =>
    n.children.some((c) => c.text === "继承父模型"));
  assert.ok(selects.length > 0, "the subagent block renders a provider select");
  return selects[0];
}

/** A select's option labels, in order. `walk` flattens, so the texts are read directly. */
function optionLabels(select) {
  return select.children.filter((n) => n.text !== undefined).map((n) => n.text);
}

test("the section registers itself under settings.section", async () => {
  const { sections, restore } = await ready();
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "settings.section");
  assert.equal(sections[0].id, "model-advanced");
  restore();
});

test("the page points input types at the Models page instead of editing them", async () => {
  const { tree, restore } = await ready();
  // Input modalities belong to the harness's own Models page now, with the same
  // inheritance semantics, so this page must not offer a second editor.
  const notes = byClass(tree, "dsw-mas-note");
  assert.equal(notes.length, 1);
  assert.match(textOf(notes[0]), /「模型」设置页/);
  assert.equal(byClass(tree, "dsw-mas-mod").length, 0, "no modality control is rendered");
  restore();
});

test("the reasoning toggle still gates the level editor only", async () => {
  const { tree, restore } = await ready();
  assert.equal(byClass(tree, "dsw-mas-card").length, 2, "one card per model");
  assert.equal(byClass(tree, "dsw-mas-rows").length, 1, "only the reasoning model has levels");
  restore();
});

test("English locale renders the English labels", async () => {
  const { tree, restore } = await ready({ locale: "en" });
  assert.match(textOf(byClass(tree, "dsw-mas-note")[0]), /Models settings page/);
  assert.equal(textOf(byClass(tree, "dsw-mas-block-title")[0]), "Thinking levels");
  restore();
});

test("saving sends every model's reasoning level dict", async () => {
  const { calls, render, restore } = await ready();
  await pressSave(render);
  const { body } = calls.find((c) => c.action === "save");
  assert.deepEqual(body.models[0], { id: "a", reasoningEfforts: { low: "low" } });
  assert.deepEqual(body.models[1], { id: "b", reasoningEfforts: false });
  restore();
});

test("an empty wire value blocks the save and names the level", async () => {
  const { tree, calls, render, restore } = await ready();
  byClass(tree, "dsw-mas-lwire")[0].props.onChange({ target: { value: "  " } });
  render();
  await pressSave(render);
  assert.equal(calls.some((c) => c.action === "save"), false, "nothing is sent");
  assert.equal(textOf(byClass(render(), "dsw-mas-msg")[0]), "「Low」没有填写发送值。");
  restore();
});

test("adding a level appends the first level no other row uses", async () => {
  const { tree, calls, render, restore } = await ready();
  // The model declares only `low`, so the first free level is `minimal`.
  const add = walk(tree).find((n) => n.type === "button" && n.className === "dsw-mas-add");
  add.props.onClick();
  const select = walk(render()).find((n) => n.props && n.props.value === "minimal");
  assert.ok(select, "the new row offers the first unused level");

  byClass(render(), "dsw-mas-lwire")[1].props.onChange({ target: { value: "minimal" } });
  render();
  await pressSave(render);
  const { body } = calls.find((c) => c.action === "save");
  assert.deepEqual(body.models[0].reasoningEfforts, { low: "low", minimal: "minimal" });
  restore();
});

test("turning the reasoning toggle off stores `false`", async () => {
  const { tree, calls, render, restore } = await ready();
  const toggle = walk(tree).find((n) => n.type === "input" && n.props.type === "checkbox" && n.props.checked === true);
  toggle.props.onChange({ target: { checked: false } });
  render();
  await pressSave(render);
  const { body } = calls.find((c) => c.action === "save");
  assert.deepEqual(body.models[0], { id: "a", reasoningEfforts: false });
  restore();
});

test("the DeveloperRole select offers all three states", async () => {
  const { tree, restore } = await ready();
  const select = developerRoleSelect(tree);
  assert.deepEqual(optionLabels(select), ["默认（自动检测）", "支持", "不支持"]);
  assert.equal(select.props.value, "", "a switch the document never set shows as the default");
  restore();
});

test("a stored DeveloperRole switch selects its own state", async () => {
  for (const [stored, expected] of [[true, "true"], [false, "false"]]) {
    const { tree, restore } = await ready({
      load: {
        routes: [{
          route: "laneai",
          displayName: "test123",
          supportsDeveloperRole: stored,
          models: [{ id: "a", name: "A", reasoningEfforts: { low: "low" } }],
        }],
        subagent: {},
      },
    });
    assert.equal(developerRoleSelect(tree).props.value, expected);
    restore();
  }
});

test("English locale renders the DeveloperRole labels", async () => {
  const { tree, restore } = await ready({ locale: "en" });
  assert.deepEqual(optionLabels(developerRoleSelect(tree)), ["Default (auto-detect)", "Supported", "Unsupported"]);
  restore();
});

test("saving sends the DeveloperRole choice", async () => {
  const { tree, calls, render, restore } = await ready();
  developerRoleSelect(tree).props.onChange({ target: { value: "false" } });
  render();
  await pressSave(render);
  const { body } = calls.find((c) => c.action === "save");
  assert.equal(body.supportsDeveloperRole, false);
  restore();
});

test("an untouched DeveloperRole choice is sent as null, not false", async () => {
  const { calls, render, restore } = await ready();
  await pressSave(render);
  const { body } = calls.find((c) => c.action === "save");
  // `null` is the request's "state no answer", which the host writes as an
  // `unset`; a default must never be persisted as a declaration.
  assert.equal(body.supportsDeveloperRole, null);
  restore();
});

test("the subagent block has its own save and posts the chosen route", async () => {
  const { tree, calls, render, restore } = await ready();
  subagentProviderSelect(tree).props.onChange({ target: { value: "laneai" } });
  render();

  const buttons = walk(render()).filter((n) => n.type === "button" && n.className === "dsw-mas-btn");
  assert.equal(buttons.length, 2, "one save per block");
  buttons[1].props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { body } = calls.find((c) => c.action === "subagent");
  assert.equal(body.provider, "laneai");
  assert.equal(calls.some((c) => c.action === "save"), false, "the subagent save does not touch llm-pi-ai");
  restore();
});

/** Two routes, with the subagent default stored against the second one. */
const twoRoutes = {
  routes: [
    { route: "laneai", displayName: "test123", models: [{ id: "a", name: "A", reasoningEfforts: false }] },
    { route: "agentrouter", displayName: "agentrouter", models: [{ id: "z", name: "Z", reasoningEfforts: false }] },
  ],
  subagent: { provider: "agentrouter", model: "z" },
};

test("a stored subagent route is the one the page shows", async () => {
  const { tree, restore } = await ready({ load: twoRoutes });
  // Showing the first route instead would misreport the stored configuration on
  // every reopen, and the model list would offer another route's models.
  assert.equal(subagentProviderSelect(tree).props.value, "agentrouter");
  const selects = byClass(tree, "dsw-mas-select").filter((n) =>
    n.children.some((c) => c.text === "继承父模型"));
  assert.equal(selects[1].props.value, "z", "the model select shows the stored model");
  assert.deepEqual(optionLabels(selects[1]), ["继承父模型", "z"]);
  restore();
});

test("a stored subagent route this page cannot list stays selectable", async () => {
  const { tree, restore } = await ready({
    load: {
      routes: [{ route: "laneai", displayName: "test123", models: [{ id: "a", name: "A", reasoningEfforts: false }] }],
      subagent: { provider: "gone", model: "g" },
    },
  });
  // Dropping it from the options would show "inherit" and rewrite the stored
  // value on the next save, which is not a choice the user made.
  assert.equal(subagentProviderSelect(tree).props.value, "gone");
  assert.deepEqual(optionLabels(subagentProviderSelect(tree)), ["继承父模型", "gone", "test123"]);
  restore();
});
