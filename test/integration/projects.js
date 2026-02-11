/**
 * dafny-replay project registry.
 * Each entry maps a project to its entry file, domain module, and kernel.
 */

import { resolve, join } from 'node:path';

const DAFNY_REPLAY = resolve(import.meta.dirname, '../../../dafny-replay');
const DAFNY2JS = join(DAFNY_REPLAY, 'dafny2js');

export { DAFNY_REPLAY, DAFNY2JS };

export const PROJECTS = [
  {
    name: 'counter',
    entry: 'counter/CounterDomain.dfy',
    module: 'CounterDomain',
    kernel: 'Replay',
  },
  {
    name: 'kanban',
    entry: 'kanban/KanbanDomain.dfy',
    module: 'KanbanDomain',
    kernel: 'Replay',
  },
  {
    name: 'colorwheel',
    entry: 'colorwheel/ColorWheelDomain.dfy',
    module: 'ColorWheelDomain',
    kernel: 'Replay',
  },
  {
    name: 'canon',
    entry: 'canon/CanonDomain.dfy',
    module: 'CanonDomain',
    kernel: 'Replay',
  },
  {
    name: 'delegation-auth',
    entry: 'delegation-auth/DelegationAuthDomain.dfy',
    module: 'DelegationAuthDomain',
    kernel: 'Replay',
  },
  {
    name: 'counter-authority',
    entry: 'counter-authority/CounterAuthority.dfy',
    module: 'CounterDomain',
    kernel: 'Authority',
  },
  {
    name: 'clear-split',
    entry: 'clear-split/ClearSplit.dfy',
    module: 'ClearSplit',
    kernel: 'ClearSplitSpec',
  },
  {
    name: 'kanban-multi',
    entry: 'kanban/KanbanMultiCollaboration.dfy',
    module: 'KanbanDomain',
    kernel: 'MultiCollaboration',
  },
  {
    name: 'clear-split-multi',
    entry: 'clear-split/ClearSplitMultiCollaboration.dfy',
    module: 'ClearSplitDomain',
    kernel: 'MultiCollaboration',
  },
  {
    name: 'collab-todo',
    entry: 'collab-todo/TodoMultiCollaboration.dfy',
    module: 'TodoDomain',
    kernel: 'MultiCollaboration',
  },
];
