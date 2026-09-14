/**
 * Regression tests for the browser half of the plugin.
 *
 * The page is mounted through `test/harness.mjs`, which renders it with a React
 * hook shim, and the assertions read the resulting element tree plus the save
 * payload the page POSTs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountClient, byClass, walk, textOf, checkboxOf } from "./harness.mjs";

/** Mount, settle the load, and return the tree with its helpers. */
async function ready(options) {
  const client = mountClient(options);
  const tree = await client.settle();
  return { ...client, tree };
}

test("the section registers itself under settings.section", async () => {
  const { sections, restore } = await ready();
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "settings.section");
  assert.equal(sections[0].id, "model-advanced");
  restore();
});

test("each model gets one modality row with both boxes", async () => {
  const { tree, restore } = await ready();
  const cards = byClass(tree, "dsw-mas-card");
  assert.equal(cards.length, 2, "one card per model");
  assert.equal(byClass(tree, "dsw-mas-mods").length, 2, "one modality row per model");

  const boxes = byClass(tree, "dsw-mas-mod");
  assert.equal(boxes.length, 4);
  assert.deepEqual(boxes.map(textOf), ["文本", "图像", "文本", "图像"]);
  restore();
});

test("declared modalities are ticked and an undeclared model is blank", async () => {
  const { tree, restore } = await ready();
  const boxes = byClass(tree, "dsw-mas-mod").map(checkboxOf);
  assert.deepEqual(boxes.slice(0, 2).map((b) => b.props.checked), [true, true]);
  assert.deepEqual(boxes.slice(2, 4).map((b) => b.props.checked), [false, false]);
  restore();
});

test("only a model declaring nothing shows the inherited hint", async () => {
  const { tree, restore } = await ready();
  const hints = byClass(tree, "dsw-mas-inherit");
  assert.equal(hints.length, 1);
  assert.equal(textOf(hints[0]), "继承：文本");
  restore();
});

test("no hint is shown when the adapter could not resolve the modalities", async () => {
  const { tree, restore } = await ready({
    load: {
      routes: [{
        route: "laneai",
        displayName: "test123",
        models: [{ id: "b", name: "B", reasoningEfforts: false }],
      }],
      subagent: {},
    },
  });
  assert.equal(byClass(tree, "dsw-mas-inherit").length, 0);
  assert.equal(byClass(tree, "dsw-mas-mod").length, 2, "the control still renders");
  restore();
});

test("the reasoning toggle still gates the level editor only", async () => {
  const { tree, restore } = await ready();
  assert.equal(byClass(tree, "dsw-mas-rows").length, 1, "only the reasoning model has levels");
  assert.equal(byClass(tree, "dsw-mas-mods").length, 2, "modalities are independent of reasoning");
  restore();
});

test("English locale renders the English labels", async () => {
  const { tree, restore } = await ready({ locale: "en" });
  assert.deepEqual(byClass(tree, "dsw-mas-mod").map(textOf), ["Text", "Image", "Text", "Image"]);
  restore();
});

test("saving sends a modality list, and omits it once every box is cleared", async () => {
  const { tree, calls, render, restore } = await ready();
  const tree2 = tree;
  // Untick "image" on model a: it keeps a declaration, so the list narrows.
  const boxes = byClass(tree2, "dsw-mas-mod");
  const image = checkboxOf(boxes[1]);
  image.props.onChange({ target: { checked: false } });
  render();

  const saveButton = walk(render()).find((n) => n.type === "button" && n.className === "dsw-mas-btn");
  saveButton.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { body } = calls.find((c) => c.action === "save");
  assert.deepEqual(body.models[0], { id: "a", input: ["text"], reasoningEfforts: { low: "low" } });
  assert.deepEqual(body.models[1], { id: "b", reasoningEfforts: false }, "an undeclared model stays undeclared");
  restore();
});

test("clearing a model's last modality returns it to inherit", async () => {
  const { tree, calls, render, restore } = await ready();
  for (const box of byClass(tree, "dsw-mas-mod").slice(0, 2)) {
    checkboxOf(box).props.onChange({ target: { checked: false } });
    render();
  }
  const current = render();
  const saveButton = walk(current).find((n) => n.type === "button" && n.className === "dsw-mas-btn");
  saveButton.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { body } = calls.find((c) => c.action === "save");
  assert.deepEqual(body.models[0], { id: "a", reasoningEfforts: { low: "low" } });
  restore();
});

test("a model with reasoning off still carries its modalities", async () => {
  const { tree, calls, render, restore } = await ready();
  const boxes = byClass(tree, "dsw-mas-mod").slice(2, 4);
  checkboxOf(boxes[1]).props.onChange({ target: { checked: true } });
  render();
  const saveButton = walk(render()).find((n) => n.type === "button" && n.className === "dsw-mas-btn");
  saveButton.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { body } = calls.find((c) => c.action === "save");
  assert.deepEqual(body.models[1], { id: "b", input: ["image"], reasoningEfforts: false });
  restore();
});
