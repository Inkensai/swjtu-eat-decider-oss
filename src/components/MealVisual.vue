<script setup lang="ts">
withDefaults(defineProps<{ busy?: boolean; selected?: boolean; sequence?: number }>(), {
  busy: false,
  selected: false,
  sequence: 0,
})
</script>

<template>
  <div class="meal-visual" :class="{ 'is-busy': busy, 'is-selected': selected }" aria-hidden="true">
    <div class="visual-guide guide-top"><span>DAILY PLATE</span><i></i><span>01 / 03</span></div>
    <div class="visual-shadow"></div>
    <div :key="sequence" class="meal-assembly">
      <div class="meal-stage">
        <div class="tray-base"></div>
        <div class="tray-inlay"><span class="tray-line"></span><span class="tray-label">A GOOD MEAL.</span><span class="tray-scale"></span></div>
        <div class="porcelain">
          <span class="plate-rim"></span>
          <span class="plate-well"></span>
          <div class="serving">
            <span class="rice"><i></i><i></i><i></i><i></i><i></i></span>
            <span class="main-bite bite-one"></span>
            <span class="main-bite bite-two"></span>
            <span class="leaf leaf-one"></span>
            <span class="leaf leaf-two"></span>
            <span class="garnish"></span>
          </div>
          <span class="plate-highlight"></span>
        </div>
        <div class="cutlery"><i></i><i></i><b></b></div>
        <div class="tray-glass"><span class="glass-edge"></span><i class="fastener f-one"></i><i class="fastener f-two"></i><i class="fastener f-three"></i><i class="fastener f-four"></i><span class="scan-light"></span></div>
      </div>
    </div>
    <span class="visual-tick tick-left"></span><span class="visual-tick tick-right"></span>
    <div class="visual-guide guide-bottom"><span>一餐，一点惊喜。</span><span class="visual-bars"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>
  </div>
</template>

<style scoped>
.meal-visual {
  position: relative;
  width: min(100%, 460px);
  height: 268px;
  margin: 0 auto;
  isolation: isolate;
  pointer-events: none;
  user-select: none;
  --plate-amber: #b58c60;
}
.visual-guide {
  position: absolute;
  left: 6%;
  right: 6%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: #85857b;
  font: 9px/1.4 "SFMono-Regular", Consolas, monospace;
  letter-spacing: 1.5px;
}
.guide-top { top: 12px; }
.guide-top > i { flex: 1; height: 1px; background: linear-gradient(90deg, #a3a19335, #a3a19300); }
.guide-bottom { bottom: 9px; font-size: 10px; letter-spacing: 2px; }
.visual-bars { display: flex; height: 10px; align-items: end; gap: 3px; }
.visual-bars i { width: 2px; background: #a29b8e; height: 5px; }
.visual-bars i:nth-child(2n) { height: 10px; }
.visual-bars i:nth-child(3n) { height: 7px; background: var(--plate-amber); }
.visual-shadow {
  position: absolute;
  width: 240px;
  height: 40px;
  left: 50%;
  bottom: 34px;
  transform: translateX(-45%) rotate(-8deg);
  background: radial-gradient(ellipse, #74705c28 0%, #74705c00 72%);
  filter: blur(9px);
}
.meal-assembly {
  position: absolute;
  left: 50%;
  top: 48%;
  width: 264px;
  height: 190px;
  transform: translate(-50%, -50%);
  perspective: 850px;
}
.meal-stage {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  transform: rotateX(29deg) rotateY(-13deg) rotateZ(-14deg);
  animation: plate-breathe 9s ease-in-out infinite;
}
.tray-base, .tray-inlay, .tray-glass {
  position: absolute;
  inset: 0;
  border: 1px solid #c5c2b68c;
  border-radius: 5px;
}
.tray-base {
  transform: translate3d(3px, 10px, -13px);
  background: linear-gradient(135deg, #f7f4ecee, #dad8cbdd);
  box-shadow: 1px 4px 0 #c8c6ba99, 2px 7px 0 #dedbd0a0, 0 18px 24px #6d685f12;
}
.tray-inlay {
  inset: 5px;
  transform: translateZ(-2px);
  background: linear-gradient(135deg, #fbfaf390, #e7e4d98a);
  box-shadow: inset 0 0 0 5px #ffffff28;
}
.tray-line { position: absolute; left: 12px; top: 12px; width: 20px; height: 1px; background: #92948a70; }
.tray-label { position: absolute; left: 14px; bottom: 11px; color: #7f8178; font: 7px/1 Consolas, monospace; letter-spacing: 1.4px; }
.tray-scale {
  position: absolute;
  bottom: 11px;
  right: 16px;
  height: 6px;
  width: 42px;
  background: repeating-linear-gradient(90deg, #9f9a8960 0 1px, transparent 1px 4px);
}
.porcelain {
  position: absolute;
  width: 151px;
  height: 151px;
  left: 39px;
  top: 17px;
  transform: translateZ(11px);
  border-radius: 50%;
  background: linear-gradient(145deg, #fffef8, #d5d3c6);
  border: 1px solid #fffdf3;
  box-shadow: 0 4px 0 #c7c5b8, 0 7px 0 #e3e0d4, 3px 12px 17px #77736025, inset -4px -3px 8px #a8a49430, inset 3px 3px 7px #ffffff;
}
.plate-rim {
  position: absolute;
  inset: 8px;
  border: 1px solid #c2bdac6b;
  border-radius: inherit;
  box-shadow: 0 1px 1px #ffffff, inset 1px 1px 1px #beb9a833;
}
.plate-well {
  position: absolute;
  inset: 21px;
  border-radius: inherit;
  background: linear-gradient(145deg, #e0ddcf, #f9f7ec 65%);
  border: 1px solid #b7b2a04a;
  box-shadow: inset 2px 3px 6px #8b846321, 1px 2px 2px #ffffffdc;
}
.plate-highlight { position: absolute; inset: 4px; border-radius: 50%; border-top: 2px solid #ffffffbc; transform: rotate(-35deg); }
.serving { position: absolute; inset: 28px; transform: rotate(10deg); }
.rice {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 48px;
  height: 48px;
  border-radius: 43% 51% 46% 48%;
  transform: rotate(16deg);
  background: radial-gradient(ellipse at 32% 26%, #fffef5, #e8e4d2 77%);
  box-shadow: 2px 3px 4px #9b91733b, inset -3px -3px 5px #c6bda144, inset 3px 3px 4px white;
}
.rice i { position: absolute; width: 7px; height: 2px; background: #dad4bc; opacity: .6; border-radius: 4px; transform: rotate(35deg); }
.rice i:nth-child(1) { top: 12px; left: 13px; }
.rice i:nth-child(2) { top: 22px; left: 28px; transform: rotate(-26deg); }
.rice i:nth-child(3) { top: 32px; left: 16px; }
.rice i:nth-child(4) { top: 23px; left: 10px; transform: rotate(-32deg); }
.rice i:nth-child(5) { top: 12px; left: 30px; }
.main-bite {
  position: absolute;
  width: 47px;
  height: 29px;
  background: linear-gradient(145deg, #d2af80, #a77649);
  border: 1px solid #d8ba91;
  border-radius: 40% 48% 44% 32%;
  box-shadow: 1px 3px 0 #926b463d, inset 0 2px 3px #edd9b59c, 1px 5px 5px #8e77552b;
}
.main-bite::after { content: ''; position: absolute; top: 10px; left: 10px; width: 24px; height: 1px; background: #f2d6a6b0; transform: rotate(-9deg); }
.bite-one { left: -1px; top: 24px; transform: rotate(-28deg); }
.bite-two { left: 20px; top: 54px; transform: rotate(18deg); width: 42px; height: 25px; }
.leaf { position: absolute; width: 20px; height: 32px; background: linear-gradient(135deg, #b1b696, #879176); border-radius: 90% 15% 85% 25%; box-shadow: 1px 2px 2px #7d805132; }
.leaf::after { content: ''; position: absolute; width: 1px; height: 23px; background: #e0dfc57a; left: 10px; top: 6px; transform: rotate(22deg); }
.leaf-one { right: 0; bottom: 6px; transform: rotate(19deg); }
.leaf-two { right: 11px; bottom: -1px; transform: rotate(-28deg) scale(.8); }
.garnish { position: absolute; width: 5px; height: 5px; background: #a09162; border-radius: 50%; top: 9px; left: 23px; box-shadow: -7px 5px 0 -1px #c1a775, 2px 9px 0 -1px #9a9b79; }
.cutlery { position: absolute; left: 205px; top: 22px; width: 27px; height: 140px; transform: translateZ(9px) rotate(6deg); }
.cutlery i { position: absolute; height: 139px; width: 4px; left: 4px; top: 0; border-radius: 2px 2px 1px 1px; background: linear-gradient(90deg, #a77a4e, #dfbd89 58%, #9b754e); box-shadow: 1px 2px 1px #7f72512e; }
.cutlery i:nth-child(2) { left: 15px; transform: rotate(2deg); }
.cutlery b { position: absolute; top: 98px; left: 0; height: 8px; width: 26px; background: linear-gradient(#fcfaf2, #c8c5b8); border: 1px solid #ffffff70; box-shadow: 0 2px 2px #8f876829; transform: translateZ(-1px); }
.tray-glass {
  transform: translateZ(29px);
  background: linear-gradient(130deg, #ffffff30 0%, #fffffb0a 48%, #ffffff35 49%, #ffffff08 70%);
  border-color: #ffffffd9;
  box-shadow: inset 0 0 0 1px #c8c4b339, 1px 2px 0 #b8b6aa4d;
  overflow: hidden;
}
.glass-edge { position: absolute; inset: 4px; border: 1px solid #ffffff50; border-radius: 3px; }
.fastener { position: absolute; width: 5px; height: 5px; background: radial-gradient(circle, #c5c4b8 25%, #f7f6ed 26% 55%, #b5b4a8 60%); border-radius: 50%; box-shadow: 0 1px 1px #7d7d6b24; }
.f-one { left: 8px; top: 8px; }.f-two { right: 8px; top: 8px; }.f-three { left: 8px; bottom: 8px; }.f-four { right: 8px; bottom: 8px; }
.scan-light { position: absolute; left: 0; right: 0; height: 60px; top: -65px; opacity: 0; border-bottom: 1px solid #c3a67b90; background: linear-gradient(transparent, #ffffff80); }
.visual-tick { position: absolute; width: 11px; height: 11px; top: 47%; opacity: .45; }
.visual-tick::before, .visual-tick::after { content: ''; position: absolute; background: #8a897b; }
.visual-tick::before { width: 11px; height: 1px; top: 5px; }.visual-tick::after { width: 1px; height: 11px; left: 5px; }
.tick-left { left: 6%; }.tick-right { right: 6%; }
.is-busy .scan-light { opacity: 1; animation: plate-scan 1.3s ease-in-out infinite; }
.is-busy .meal-stage { animation-play-state: paused; }
.is-selected .meal-assembly { animation: plate-reveal 700ms cubic-bezier(.22,.68,.22,1) both; }
.is-selected .tray-glass { border-color: #fdf9ee; }
@keyframes plate-breathe {
  0%, 100% { transform: rotateX(29deg) rotateY(-13deg) rotateZ(-14deg) translateY(0); }
  50% { transform: rotateX(29.7deg) rotateY(-12deg) rotateZ(-14deg) translateY(-3px); }
}
@keyframes plate-scan { from { transform: translateY(0); } to { transform: translateY(260px); } }
@keyframes plate-reveal { from { opacity: .4; transform: translate(-50%, -45%); } to { opacity: 1; transform: translate(-50%, -50%); } }
@media (max-width: 620px) {
  .meal-visual { height: 230px; max-width: 400px; }
  .meal-assembly { width: 264px; height: 190px; scale: .86; }
  .guide-top { top: 5px; }.guide-bottom { bottom: 5px; }
  .visual-shadow { bottom: 28px; width: 210px; }
}
@media (max-width: 360px) {
  .meal-assembly { scale: .76; }
  .meal-visual { height: 210px; }
}
@media (prefers-reduced-motion: reduce) {
  .meal-stage, .is-busy .scan-light, .is-selected .meal-assembly { animation: none; }
  .is-busy .scan-light { top: 50%; opacity: .4; }
}
:global([data-motion="reduced"] .meal-visual .meal-stage),
:global([data-motion="reduced"] .meal-visual.is-busy .scan-light),
:global([data-motion="reduced"] .meal-visual.is-selected .meal-assembly) { animation: none; }
:global([data-motion="reduced"] .meal-visual.is-busy .scan-light) { top: 50%; opacity: .4; }
</style>
