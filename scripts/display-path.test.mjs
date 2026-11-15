import assert from 'node:assert/strict';
import {test} from 'node:test';
import {displayPath} from '../src/desktop/display-path.ts';

test('Windows extended drive paths display naturally without changing their content',()=>{
  const canonical='\\\\?\\C:\\资料\\2026 春季工作\\ ';
  // Preserve whitespace and separators: presentation is not path normalization.
  assert.equal(displayPath(canonical),canonical.slice(4));
  assert.equal(canonical.startsWith('\\\\?\\'),true);
  assert.equal(displayPath('\\\\?\\D:\\'),'D:\\');
});

test('Windows extended UNC paths retain the network server and share',()=>{
  assert.equal(displayPath('\\\\?\\UNC\\server\\team\\work.txt'),'\\\\server\\team\\work.txt');
  assert.equal(displayPath('\\\\?\\unc\\电脑\\共享'),'\\\\电脑\\共享');
  assert.equal(displayPath('\\\\?\\UNC\\server\\team\\'),'\\\\server\\team\\');
});

test('ordinary paths and non-filesystem namespaces are left intact',()=>{
  for(const path of [
    '', 'C:\\资料\\work', '\\\\server\\share\\work', '/Users/syncfu/资料',
    'relative/file.txt', '\\\\?\\Volume{abc}\\work', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1',
    '\\\\.\\PhysicalDrive0', '\\\\?\\UNC\\server', '\\\\?\\C:relative',
  ])assert.equal(displayPath(path),path);
});
