// Fork guard — docker-publish.yml derives its registry targets from the repo owner,
// so a fork publishes to its own GHCR namespace. Docker Hub is opt-in through the
// PUBLISH_DOCKERHUB repository variable; without it, every Docker Hub step is skipped.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/docker-publish.yml", import.meta.url)),
  "utf8"
);

function stepBlock(name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `step "${name}" not found`);
  const next = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

function allStepBlocks(name: string): string[] {
  const blocks: string[] = [];
  let at = workflow.indexOf(`- name: ${name}\n`);
  while (at !== -1) {
    const next = workflow.indexOf("\n      - name:", at + 1);
    blocks.push(workflow.slice(at, next === -1 ? undefined : next));
    at = workflow.indexOf(`- name: ${name}\n`, at + 1);
  }
  return blocks;
}

test("registry names come from the repo owner, not a hardcoded namespace", () => {
  assert.match(
    workflow,
    /GHCR_IMAGE_NAME: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/omniroute/
  );
  assert.match(
    workflow,
    /IMAGE_NAME: \$\{\{ vars\.DOCKERHUB_NAMESPACE \|\| github\.repository_owner \}\}\/omniroute/
  );
  assert.doesNotMatch(workflow, /^\s+(GHCR_)?IMAGE_NAME: (ghcr\.io\/)?diegosouzapw\//m);
  assert.doesNotMatch(workflow, /repository: diegosouzapw\/omniroute/);
  assert.doesNotMatch(workflow, /docker manifest inspect "diegosouzapw\//);
});

test("every Docker Hub step is gated on PUBLISH_DOCKERHUB", () => {
  const logins = allStepBlocks("Login to Docker Hub");
  assert.equal(logins.length, 2);
  for (const login of logins) assert.match(login, /if: env\.PUBLISH_DOCKERHUB == 'true'/);
  for (const name of [
    "Create Docker Hub version manifests",
    "Promote Docker Hub latest tags",
    "Update Docker Hub description",
  ]) {
    assert.match(stepBlock(name), /env\.PUBLISH_DOCKERHUB == 'true'/, name);
  }
});

test("the already-published skip probe only runs when Docker Hub publishing is on", () => {
  const resolve = stepBlock("Resolve version, latest-promotion, and skip flag");
  assert.match(resolve, /\[ "\$PUBLISH_DOCKERHUB" = "true" \]/);
  assert.match(resolve, /docker manifest inspect "\$\{IMAGE_NAME\}:\$\{VERSION\}"/);
});

test("Docker Hub tags are pushed only when publishing is on", () => {
  const tagBlocks = workflow.match(/tags: \|\n(?:\s+\$\{\{[^\n]+\}\}\n)+/g) ?? [];
  assert.equal(tagBlocks.length, 4);
  for (const block of tagBlocks) {
    assert.match(block, /\$\{\{ env\.GHCR_IMAGE_NAME \}\}/);
    assert.match(block, /\$\{\{ env\.PUBLISH_DOCKERHUB == 'true' && env\.IMAGE_NAME \|\| '' \}\}/);
  }
});

test("smoke test and inspect read the GHCR image, which is always published", () => {
  assert.match(
    stepBlock("Smoke-test published Docker image"),
    /"\$\{GHCR_IMAGE_NAME\}:\$\{VERSION\}"/
  );
  assert.match(stepBlock("Inspect image"), /"\$\{GHCR_IMAGE_NAME\}:\$\{VERSION\}"/);
});

test("workflow_dispatch can build an explicit ref", () => {
  assert.match(workflow, /\n {6}ref:\n {8}description:/);
  const checkouts = allStepBlocks("Checkout");
  assert.equal(checkouts.length, 3);
  for (const checkout of checkouts) {
    assert.match(checkout, /inputs\.ref \|\| format\('refs\/tags\/v\{0\}', inputs\.version\)/);
  }
});
