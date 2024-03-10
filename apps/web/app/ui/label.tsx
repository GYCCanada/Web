import clsx from 'clsx';
import { Label, LabelProps } from 'react-aria-components';

const _Label = ({ className, ...props }: LabelProps) => (
  <Label
    className={clsx(
      'text-lg leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70 group-data-[variant="negative"]:text-neutral-950 group-data-[variant="positive"]:text-neutral-50',
      className,
    )}
    style={{
      gridArea: 'label',
    }}
    {...props}
  />
);

export { _Label as Label };
