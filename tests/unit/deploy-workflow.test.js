import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

describe('Heroku deploy workflow', () => {
  it('extracts a bare Heroku token before using the credential', () => {
    expect(workflow).toContain('id: heroku-credential');
    expect(workflow).toContain("jq -er '.access_token // .token // empty'");
    expect(workflow).toContain('echo "::add-mask::$HEROKU_TOKEN"');
    expect(workflow).toContain('echo "token=$HEROKU_TOKEN" >> "$GITHUB_OUTPUT"');
  });

  it('uses only the normalized token for Heroku API and Git operations', () => {
    expect(workflow).toContain('HEROKU_API_KEY: ${{ steps.heroku-credential.outputs.token }}');
    expect(workflow).toContain('HEROKU_TOKEN: ${{ steps.heroku-credential.outputs.token }}');
    expect(workflow).not.toContain('HEROKU_API_KEY: ${{ secrets.HEROKU_API_KEY }}');
    expect(workflow).not.toContain('https://heroku:${{ secrets.HEROKU_API_KEY }}@git.heroku.com');
  });
});
