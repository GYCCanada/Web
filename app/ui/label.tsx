import clsx from 'clsx';
import * as React from 'react';

import { useTextField } from './text-field';

export const labelStyles =
  'text-foreground text-lg leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70';

const _Label = ({
  className,
  children,
  ...props
}: React.ComponentProps<'label'>) => {
  const { meta, controlId, labelId } = useTextField();
  return (
    <label
      id={labelId}
      htmlFor={controlId}
      className={clsx(labelStyles, className)}
      style={{
        gridArea: 'label',
      }}
      {...props}
    >
      {children}
      {meta.required && <span className="text-red-500">*</span>}
    </label>
  );
};

export { _Label as Label };
