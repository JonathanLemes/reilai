import { root } from '@lynx-js/react';

import '../../ui/base.css';
import { ThemeRoot } from '../../shared/theme';
import { Pair } from './Pair';

root.render(
  <ThemeRoot>
    <Pair />
  </ThemeRoot>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
