import { derived, writable } from 'svelte/store';

const MAX_HISTORY = 240;

const INITIAL_STATE = {
  history: [],
  playbackIndex: -1,
  followLatest: true
};

function clampPlaybackIndex(historyLength, playbackIndex) {
  if (historyLength === 0) {
    return -1;
  }

  return Math.min(Math.max(playbackIndex, 0), historyLength - 1);
}

function createDatapointStore() {
  const { subscribe, update, set } = writable(INITIAL_STATE);

  return {
    subscribe,
    append(snapshot) {
      update((state) => {
        const history = [...state.history, snapshot];
        const overflow = Math.max(0, history.length - MAX_HISTORY);
        const trimmedHistory = overflow > 0 ? history.slice(overflow) : history;
        const nextPlaybackIndex = clampPlaybackIndex(
          trimmedHistory.length,
          state.followLatest ? trimmedHistory.length - 1 : state.playbackIndex - overflow
        );

        return {
          history: trimmedHistory,
          playbackIndex: nextPlaybackIndex,
          followLatest: state.followLatest
        };
      });
    },
    rewind(step = 1) {
      update((state) => {
        if (state.history.length === 0) {
          return state;
        }

        return {
          ...state,
          playbackIndex: clampPlaybackIndex(state.history.length, state.playbackIndex - step),
          followLatest: false
        };
      });
    },
    fastForward(step = 1) {
      update((state) => {
        if (state.history.length === 0) {
          return state;
        }

        const playbackIndex = clampPlaybackIndex(state.history.length, state.playbackIndex + step);

        return {
          ...state,
          playbackIndex,
          followLatest: playbackIndex === state.history.length - 1
        };
      });
    },
    goLatest() {
      update((state) => {
        if (state.history.length === 0) {
          return state;
        }

        return {
          ...state,
          playbackIndex: state.history.length - 1,
          followLatest: true
        };
      });
    },
    seek(targetIndex) {
      update((state) => {
        if (state.history.length === 0) {
          return state;
        }

        const playbackIndex = clampPlaybackIndex(state.history.length, targetIndex);

        return {
          ...state,
          playbackIndex,
          followLatest: playbackIndex === state.history.length - 1
        };
      });
    },
    clear() {
      set(INITIAL_STATE);
    }
  };
}

export const datapointStore = createDatapointStore();

export const playbackState = derived(datapointStore, ($state) => {
  const historyLength = $state.history.length;
  const playbackIndex = clampPlaybackIndex(historyLength, $state.playbackIndex);
  const currentSnapshot = playbackIndex >= 0 ? $state.history[playbackIndex] : null;
  const renderedPointCount = playbackIndex >= 0
    ? $state.history.slice(0, playbackIndex + 1).reduce((sum, snapshot) => sum + snapshot.pointCount, 0)
    : 0;

  return {
    ...$state,
    historyLength,
    playbackIndex,
    currentSnapshot,
    renderedPointCount,
    isAtLatest: historyLength > 0 && playbackIndex === historyLength - 1
  };
});
