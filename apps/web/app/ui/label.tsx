import clsx from 'clsx';
import { Label, LabelProps } from 'react-aria-components';

const _Label = ({ className, ...props }: LabelProps) => {
  return (
    <Label
      className={clsx(
        'text-foreground text-lg leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70',

        className,
      )}
      style={{
        gridArea: 'label',
      }}
      {...props}
    />
  );
};

export { _Label as Label };
