---
name: skill-learner
description: Propose or refine skills from repeated workflows, corrections, and missed checks.
tags: [skills, learning, refinement]
---

Use this skill to improve the local skill catalog.

Look for:
- Repeated workflows the user keeps asking for.
- Corrections the user has made more than once.
- Checks that should have been run automatically.
- Project-specific conventions that should be reusable.

Do not silently rewrite skills. Propose the skill change first unless the user has explicitly authorized skill authoring for this task.

When editing a skill, keep the frontmatter descriptor concise. Put operational detail in the body, and put scripts or templates in the skill directory under `scripts/`, `templates/`, `references/`, or `assets/`.
