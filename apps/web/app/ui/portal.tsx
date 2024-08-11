import ReactDOM from 'react-dom';
import invariant from 'tiny-invariant';

export function Portal({
	children,
	container,
}: {
	children: React.ReactNode;
	container?: string | HTMLElement;
}): React.ReactNode {
	const el = container
		? typeof container === 'string'
			? document.getElementById(container)
			: container
		: document.body;
	invariant(
		el,
		'[Portal]: expected a container to be provided or a container with the given id to exist in the document.',
	);
	return ReactDOM.createPortal(children, el);
}
