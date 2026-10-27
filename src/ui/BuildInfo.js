import { BUILD_INFO } from '../dev/buildInfo.js';

export function initBuildInfo() {
  for (const element of document.querySelectorAll('[data-build-info]')) {
    element.querySelector('[data-build-branch]').textContent = BUILD_INFO.branch;
    const commit = element.querySelector('[data-build-commit]');
    commit.textContent = BUILD_INFO.revision;
    if (/^[a-f0-9]{40}$/.test(BUILD_INFO.commit)) {
      commit.href = `https://github.com/stlim0727/flight3d/commit/${BUILD_INFO.commit}`;
    } else {
      // Source archives have no revision to link to.
      commit.removeAttribute('href');
    }
  }
}
