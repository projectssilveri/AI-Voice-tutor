import type { ReactNode } from "react";

export type Feature = {
  id: number;
  // Was `JSX.Element`. React 19's types removed the global JSX namespace, so
  // the element type has to be imported rather than assumed.
  icon: ReactNode;
  title: string;
  paragraph: string;
};
