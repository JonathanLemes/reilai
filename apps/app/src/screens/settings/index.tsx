import { root } from '@lynx-js/react';

import '../../ui/base.css';
import { ThemeRoot } from '../../shared/theme';
import { Settings } from './Settings';

root.render(
  <ThemeRoot>
    <Settings />
  </ThemeRoot>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
