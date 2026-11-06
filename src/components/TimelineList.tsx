import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { TimelineItem } from '../lib/timeline.ts';
import { TimelineItemRow } from './TimelineItemRow.tsx';
import { colors } from './theme.ts';

const BOTTOM_SLACK = 48;

/**
 * Linha do tempo rolável. Com `follow`, acompanha o item mais novo — a menos
 * que o usuário tenha rolado para cima; aí aparece "Novos eventos ↓" para voltar.
 */
export function TimelineList({ items, follow, emptyText }: { items: TimelineItem[]; follow: boolean; emptyText: string }) {
  const listRef = useRef<FlatList<TimelineItem>>(null);
  // Só o dedo do usuário tira a lista do "fundo"; a rolagem automática não.
  const stickRef = useRef(true);
  const draggingRef = useRef(false);
  const firstLayoutRef = useRef(true);
  const [hasUnseen, setHasUnseen] = useState(false);

  const isAtBottom = ({ contentOffset, layoutMeasurement, contentSize }: NativeScrollEvent) =>
    contentOffset.y + layoutMeasurement.height >= contentSize.height - BOTTOM_SLACK;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const atBottom = isAtBottom(e.nativeEvent);
    if (draggingRef.current) stickRef.current = atBottom;
    if (atBottom) {
      stickRef.current = true;
      if (hasUnseen) setHasUnseen(false);
    }
  };

  const onDragEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    draggingRef.current = false;
    stickRef.current = isAtBottom(e.nativeEvent);
  };

  const onContentSizeChange = () => {
    if (!follow) return;
    if (stickRef.current) {
      listRef.current?.scrollToEnd({ animated: !firstLayoutRef.current });
      firstLayoutRef.current = false;
    } else {
      setHasUnseen(true);
    }
  };

  const jumpToEnd = () => {
    stickRef.current = true;
    setHasUnseen(false);
    listRef.current?.scrollToEnd({ animated: true });
  };

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={({ item }) => <TimelineItemRow item={item} />}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onScrollBeginDrag={() => {
          draggingRef.current = true;
        }}
        onScrollEndDrag={onDragEnd}
        onMomentumScrollEnd={(e) => {
          stickRef.current = isAtBottom(e.nativeEvent);
        }}
        onContentSizeChange={onContentSizeChange}
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        contentContainerStyle={styles.content}
      />
      {follow && hasUnseen && (
        <Pressable style={styles.jump} onPress={jumpToEnd} accessibilityRole="button">
          <Text style={styles.jumpText}>Novos eventos ↓</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { padding: 8 },
  empty: { color: colors.muted, fontStyle: 'italic', padding: 8 },
  jump: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  jumpText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
