// Regenerates the README screenshots:
//   TV_VIEWPORT=1180x840x2 node test/shot.mjs examples/demo.tex docs test/readme.scenario.mjs
export default async function (t) {
  await t.shot('rendered');
  await t.page.focus('.cm-content');
  await t.goto('\\BR(Q_{-i}) = \\max', 31, 'center');
  await t.scrollTo('\\begin{definition}', 'start');
  await t.shot('editing');
  await t.goto('$a - c - b\\,Q_{-i} - 2b\\,q_i = 0$', 28);
  await t.scrollTo('\\begin{lemma}', 'start');
  await t.shot('inline');
}
