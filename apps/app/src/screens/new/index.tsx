import { root } from '@lynx-js/react';

import '../../ui/base.css';
import { ThemeRoot } from '../../shared/theme';
import { NewSession } from './NewSession';

root.render(
  <ThemeRoot>
    <NewSession />
  </ThemeRoot>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
