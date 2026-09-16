import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import setCharacter from "./utils/character";
import setLighting from "./utils/lighting";
import handleResize from "./utils/resizeUtils";
import {
  handleMouseMove,
  handleTouchEnd,
  handleHeadRotation,
  handleTouchMove,
} from "./utils/mouseUtils";
import setAnimations from "./utils/animationUtils";
import Loading from "../Loading";

const Scene = () => {
  const canvasDiv = useRef<HTMLDivElement | null>(null);
  const hoverDivRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef(new THREE.Scene());
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [character, setChar] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    if (canvasDiv.current) {
      const rect = canvasDiv.current.getBoundingClientRect();
      const container = { width: rect.width, height: rect.height };
      const aspect = container.width / container.height;
      const scene = sceneRef.current;

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
      });
      renderer.setSize(container.width, container.height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      canvasDiv.current.appendChild(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(14.5, aspect, 0.1, 1000);
      camera.position.z = 10;
      camera.position.set(0, 13.1, 24.7);
      camera.zoom = 1.1;
      camera.updateProjectionMatrix();

      let headBone: THREE.Object3D | null = null;
      let screenLight: THREE.Object3D | null = null;
      let mixer: THREE.AnimationMixer;
      let rafId: number | null = null;
      let isDisposed = false;

      const clock = new THREE.Clock();

      const light = setLighting(scene);

      // Progress callback for actual model loading
      const onProgress = (progress: number) => {
        setLoadingProgress(Math.round(progress));
        if (progress >= 100) {
          // Wait a bit after reaching 100% before hiding loading screen
          setTimeout(() => {
            setIsLoading(false);
          }, 3500);
        }
      };

      const { loadCharacter } = setCharacter(
        renderer,
        scene,
        camera,
        onProgress
      );

      loadCharacter().then((gltf) => {
        if (isDisposed) {
          // Component was unmounted (e.g. React StrictMode double-invoke)
          // before loading finished — don't attach anything to a dead scene.
          return;
        }
        if (gltf) {
          const animations = setAnimations(gltf);
          hoverDivRef.current && animations.hover(gltf, hoverDivRef.current);
          mixer = animations.mixer;
          const character = gltf.scene;
          setChar(character);
          scene.add(character);
          headBone = character.getObjectByName("spine006") || null;
          screenLight = character.getObjectByName("screenlight") || null;

          // Model fully loaded, wait a bit before turning on lights and starting intro
          setTimeout(() => {
            light.turnOnLights();
            animations.startIntro();
          }, 1500);

          window.addEventListener("resize", () =>
            handleResize(renderer, camera, canvasDiv, character)
          );
        }
      });

      let mouse = { x: 0, y: 0 },
        interpolation = { x: 0.1, y: 0.2 };

      const onMouseMove = (event: MouseEvent) => {
        handleMouseMove(event, (x, y) => (mouse = { x, y }));
      };
      let debounce: number | undefined;
      const onTouchStart = (event: TouchEvent) => {
        const element = event.target as HTMLElement;
        debounce = setTimeout(() => {
          element?.addEventListener("touchmove", (e: TouchEvent) =>
            handleTouchMove(e, (x, y) => (mouse = { x, y }))
          );
        }, 200);
      };

      const onTouchEnd = () => {
        handleTouchEnd((x, y, interpolationX, interpolationY) => {
          mouse = { x, y };
          interpolation = { x: interpolationX, y: interpolationY };
        });
      };

      document.addEventListener("mousemove", (event) => {
        onMouseMove(event);
      });
      const landingDiv = document.getElementById("landingDiv");
      if (landingDiv) {
        landingDiv.addEventListener("touchstart", onTouchStart);
        landingDiv.addEventListener("touchend", onTouchEnd);
      }
      const animate = () => {
        rafId = requestAnimationFrame(animate);
        if (headBone) {
          handleHeadRotation(
            headBone,
            mouse.x,
            mouse.y,
            interpolation.x,
            interpolation.y,
            THREE.MathUtils.lerp
          );
          light.setPointLight(screenLight);
        }
        const delta = clock.getDelta();
        if (mixer) {
          mixer.update(delta);
        }
        renderer.render(scene, camera);
      };
      animate();
      return () => {
        isDisposed = true;
        clearTimeout(debounce);

        // Stop the render loop first — this is the #1 cause of the
        // out-of-memory crash: without this, every mount (React
        // StrictMode double-invokes effects in dev, and any remount
        // in prod) leaves its OLD requestAnimationFrame loop running
        // forever, each one still calling renderer.render() every
        // frame on a scene/renderer that's supposed to be dead.
        // Multiply that by a few remounts and you exhaust GPU/JS heap.
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }

        window.removeEventListener("resize", () =>
          handleResize(renderer, camera, canvasDiv, character!)
        );
        if (landingDiv) {
          document.removeEventListener("mousemove", onMouseMove);
          landingDiv.removeEventListener("touchstart", onTouchStart);
          landingDiv.removeEventListener("touchend", onTouchEnd);
        }

        // Dispose GPU resources (geometries, materials, textures) before
        // clearing the scene graph, otherwise WebGL memory isn't freed.
        scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry?.dispose();
            const material = obj.material;
            const materials = Array.isArray(material) ? material : [material];
            materials.forEach((mat) => {
              Object.values(mat).forEach((value) => {
                if (value instanceof THREE.Texture) {
                  value.dispose();
                }
              });
              mat.dispose?.();
            });
          }
        });
        scene.clear();
        renderer.dispose();
        renderer.forceContextLoss();

        if (canvasDiv.current) {
          try {
            canvasDiv.current.removeChild(renderer.domElement);
          } catch {
            // already removed
          }
        }
      };
    }
  }, []);

  return (
    <>
      {isLoading && <Loading percent={loadingProgress} />}
      <div className="character-container">
        <div className="character-model" ref={canvasDiv}>
          <div className="character-rim"></div>
          <div className="character-hover" ref={hoverDivRef}></div>
        </div>
      </div>
    </>
  );
};

export default Scene;
