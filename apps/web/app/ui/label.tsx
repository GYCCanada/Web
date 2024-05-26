import clsx from 'clsx';
import { Label, LabelProps } from 'react-aria-components';

import { useTextField } from './text-field';

export const labelStyles =
  'text-foreground text-lg leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70';

const _Label = ({ className, children, ...props }: LabelProps) => {
  const { meta } = useTextField();
  return (
    <Label
      className={clsx(labelStyles, className)}
      style={{
        gridArea: 'label',
      }}
      {...props}
    >
      {children}
      {meta.required && <span className="text-red-500">*</span>}
    </Label>
  );
};

export { _Label as Label };
