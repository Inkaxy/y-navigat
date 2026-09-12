import * as fabric from "fabric";

/**
 * Fabric 7 endret standard origin fra «left/top» til «center».
 * Kakedesign som allerede er lagret (editor_state) ble skrevet med Fabric 6,
 * der objekter uten eksplisitt origin ble plassert fra øvre venstre hjørne.
 * Vi låser derfor standardene tilbake til Fabric 6-semantikken, slik at både
 * gamle design, klippemasken og nye objekter havner på nøyaktig samme sted.
 *
 * Objekter som eksplisitt setter originX/originY (tekst, bilder, sirkelmaske)
 * er upåvirket.
 */
export function configureFabricLegacyOrigins(): void {
  fabric.FabricObject.ownDefaults.originX = "left";
  fabric.FabricObject.ownDefaults.originY = "top";
}

configureFabricLegacyOrigins();
