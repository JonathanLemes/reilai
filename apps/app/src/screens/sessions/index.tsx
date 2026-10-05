import { root } from '@lynx-js/react';

import '../../ui/base.css';
import { ThemeRoot } from '../../shared/theme';
import { Sessions } from './Sessions';

root.render(
  <ThemeRoot>
    <Sessions />
  </ThemeRoot>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
