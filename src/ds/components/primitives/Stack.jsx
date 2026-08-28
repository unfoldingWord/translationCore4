import React from 'react';

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };

/**
 * Flex or grid arrangement with a real `gap`. Sibling groups are laid out with
 * gap, never with per-element margins or source whitespace, so reordering,
 * deleting and duplicating a child cannot change the spacing.
 */
export function Stack({
  direction = 'column', gap = 0, align, justify, wrap, inline, columns,
  flex, grow, as = 'div', children, style, ...rest
}) {
  const Tag = as;
  return (
    <Tag style={{
      display: columns ? 'grid' : (inline ? 'inline-flex' : 'flex'),
      ...(columns ? { gridTemplateColumns: typeof columns === 'number' ? 'repeat(' + columns + ',minmax(0,1fr))' : columns }
                  : { flexDirection: direction }),
      gap, alignItems: ALIGN[align], justifyContent: JUSTIFY[justify],
      flexWrap: wrap ? 'wrap' : undefined,
      flex: flex != null ? flex : (grow ? 1 : undefined),
      minWidth: 0,
      ...style,
    }} {...rest}>{children}</Tag>
  );
}
