package local.overworld.hardcore;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import java.util.logging.Level;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;

public final class HardcoreResetPlugin extends JavaPlugin implements Listener {
    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private final DeathLatch latch = new DeathLatch();
    private Path bridge;
    private JsonObject settings = new JsonObject();
    private String manualId;

    @Override public void onEnable() {
        bridge = getDataFolder().toPath();
        try { Files.createDirectories(bridge); refresh(); } catch(Exception e) { fail(e); }
        for(World world:getServer().getWorlds()) { world.setHardcore(true); world.setDifficulty(Difficulty.HARD); }
        getServer().getPluginManager().registerEvents(this, this);
        getServer().getScheduler().runTaskTimer(this, () -> {
            try {
                refresh(); snapshot();
                Path request = bridge.resolve("manual.json");
                if(Files.exists(request)) {
                    JsonObject data = gson.fromJson(Files.readString(request), JsonObject.class);
                    if(data.get("runId").getAsString().equals(runId()) && !data.get("eventId").getAsString().equals(manualId)) {
                        manualId=data.get("eventId").getAsString();latch.hold();
                        Files.delete(request);
                        broadcast("La run termina por decisión administrativa.");
                        countdown(data.get("seconds").getAsInt(), data.get("eventId").getAsString());
                    }
                }
            } catch(Exception e) { fail(e); }
        }, 1L, 20L);
        getLogger().info("HardcoreReset 1.0.0: API PlayerDeathEvent; mundo actual protegido hasta armar la run.");
    }
    private String runId() { return settings.has("runId") ? settings.get("runId").getAsString() : "unconfigured"; }
    private boolean flag(String key) { return settings.has(key) && settings.get(key).getAsBoolean(); }
    private void refresh() throws Exception {
        Path file = bridge.resolve("control.json");
        if(!Files.exists(file)) { settings = new JsonObject(); return; }
        settings = gson.fromJson(Files.readString(file), JsonObject.class);
        if(flag("ended")) latch.hold();
    }
    @EventHandler(priority=EventPriority.MONITOR, ignoreCancelled=true)
    public void death(PlayerDeathEvent event) {
        Player player=event.getEntity();
        if(!player.isOnline() || getServer().getPlayer(player.getUniqueId())!=player) return;
        try { refresh(); } catch(Exception e) { fail(e); return; }
        if(!latch.begin(flag("armed"),flag("enabled"))) return;
        String id=UUID.randomUUID().toString();
        try {
            JsonObject data=new JsonObject();
            data.addProperty("eventId",id); data.addProperty("runId",runId());
            data.addProperty("player",player.getName()); data.addProperty("uuid",player.getUniqueId().toString());
            data.addProperty("at",Instant.now().toString());
            data.addProperty("seed",Long.toString(getServer().getWorlds().getFirst().getSeed()));
            Component message=event.deathMessage();
            if(message!=null)data.addProperty("cause",PlainTextComponentSerializer.plainText().serialize(message));
            data.addProperty("seconds",settings.get("seconds").getAsInt());
            write("death.json",data);
            broadcast("☠ "+player.getName()+" ha muerto. La run Hardcore ha terminado.");
            countdown(data.get("seconds").getAsInt(),id);
        } catch(Exception e) { fail(e); broadcast("Reset pausado por un error. Revisa el panel Hardcore."); }
    }
    private void countdown(int seconds,String id) {
        int duration=Math.clamp(seconds,5,60);
        broadcast("Generando un nuevo mundo en "+duration+" segundos…");
        new BukkitRunnable() {
            int remaining=duration;
            public void run() {
                try {
                    if(remaining<=0) {
                        JsonObject ready=new JsonObject();ready.addProperty("eventId",id);ready.addProperty("runId",runId());
                        ready.addProperty("at",Instant.now().toString());write("ready.json",ready);
                        broadcast("Guardando la run. El servidor se reiniciará; vuelve a conectarte después.");
                        cancel(); return;
                    }
                    if(remaining!=duration)broadcast("Nuevo mundo en "+remaining+" segundos…");
                    remaining--;
                } catch(Exception e) { cancel(); fail(e); }
            }
        }.runTaskTimer(this,0L,20L);
    }
    @EventHandler public void join(PlayerJoinEvent e) {
        if(latch.ended()||flag("initializing")) e.getPlayer().kick(Component.text("La run se está preparando. Espera al nuevo mundo."));
    }
    @EventHandler public void move(PlayerMoveEvent e) {
        if(latch.ended() && e.hasChangedPosition()) e.setTo(e.getFrom());
    }
    @EventHandler public void respawn(PlayerRespawnEvent e) {
        if(latch.ended())getServer().getScheduler().runTask(this,()->e.getPlayer().setGameMode(GameMode.SPECTATOR));
    }
    private void broadcast(String text) { getServer().broadcast(Component.text(text)); }
    private void snapshot() throws Exception {
        JsonObject data=new JsonObject();data.addProperty("version","1.0.0");data.addProperty("runId",runId());
        data.addProperty("at",Instant.now().toString());data.addProperty("ended",latch.ended());
        JsonArray worlds=new JsonArray();
        for(World world:getServer().getWorlds()) {
            JsonObject item=new JsonObject();item.addProperty("name",world.getName());item.addProperty("key",world.getKey().toString());
            item.addProperty("folder",world.getWorldFolder().getCanonicalPath());item.addProperty("seed",Long.toString(world.getSeed()));
            item.addProperty("hardcore",world.isHardcore());item.addProperty("difficulty",world.getDifficulty().name());worlds.add(item);
        }
        data.add("worlds",worlds);write("snapshot.json",data);
    }
    private void write(String name,JsonObject data) throws Exception {
        Path temp=bridge.resolve(name+".tmp");Files.writeString(temp,gson.toJson(data),StandardCharsets.UTF_8);
        Files.move(temp,bridge.resolve(name),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
    }
    private void fail(Exception e) { getLogger().log(Level.SEVERE,"HardcoreReset: operación pausada para proteger el mundo",e); }
}
