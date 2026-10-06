package local.overworld.hardcore;

import java.util.concurrent.atomic.AtomicBoolean;

public final class DeathLatch {
    private final AtomicBoolean ended = new AtomicBoolean(false);
    public boolean begin(boolean armed, boolean enabled) {
        return armed && enabled && ended.compareAndSet(false, true);
    }
    public boolean ended() { return ended.get(); }
    public void hold() { ended.set(true); }
}
