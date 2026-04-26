#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';
import { discoverFiles } from './lib/files.mjs';

const root = process.cwd();
const featureFiles = await discoverFiles(root, (file) => file.endsWith('.feature'));

if (featureFiles.length === 0) {
  console.error('No Gherkin feature files found. Add at least one *.feature file.');
  process.exit(1);
}

let failed = false;
for (const file of featureFiles) {
  const data = await readFile(file, 'utf8');
  const envelopes = generateMessages(
    data,
    pathToFileURL(file).href,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    {
      defaultDialect: 'en',
      includeGherkinDocument: true,
      includePickles: true,
      newId: IdGenerator.uuid(),
    },
  );
  const hasParseError = envelopes.some((envelope) => envelope.parseError);
  const pickleCount = envelopes.filter((envelope) => envelope.pickle).length;
  if (hasParseError || pickleCount === 0) {
    failed = true;
    console.error(`Invalid or empty feature spec: ${relative(root, file)}`);
  }
}

if (failed) process.exit(1);
console.log(
  `Gherkin specs ok (${featureFiles.length} file${featureFiles.length === 1 ? '' : 's'}).`,
);
