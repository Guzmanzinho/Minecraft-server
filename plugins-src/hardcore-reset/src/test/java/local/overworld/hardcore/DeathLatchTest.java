package local.overworld.hardcore;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
public final class DeathLatchTest {
    public static void main(String[] args) throws Exception {
        DeathLatch latch=new DeathLatch();
        if(latch.begin(false,true)||latch.begin(true,false))throw new AssertionError("Run protegida/disabled");
        AtomicInteger resets=new AtomicInteger();CountDownLatch start=new CountDownLatch(1);
        try(ExecutorService pool=Executors.newFixedThreadPool(32)) {
            for(int n=0;n<32;n++)pool.submit(()->{try{start.await();if(latch.begin(true,true))resets.incrementAndGet();}catch(InterruptedException e){throw new RuntimeException(e);}});
            start.countDown();pool.shutdown();if(!pool.awaitTermination(5,TimeUnit.SECONDS))throw new AssertionError("Timeout");
        }
        if(resets.get()!=1||!latch.ended())throw new AssertionError("Debe ejecutarse solo un reset");
        if(latch.begin(true,true))throw new AssertionError("Segunda muerte");
        System.out.println("DeathLatch: 32 muertes simultáneas => 1 reset; protegida y disabled => 0.");
    }
}
