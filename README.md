# Quantum Hardstore - Imagenes de Productos

Repositorio separado para imagenes de componentes.

Estructura:

- `originales/`: imagenes descargadas desde fuente oficial o proveedor validado.
- `procesadas_1000x1000/`: PNG finales, transparentes, centradas en lienzo 1000x1000.
- `pendientes_revision/`: productos con fuente bloqueada, dudosa o que requieren control manual.
- `scripts/`: herramientas de recorte, transparencia y normalizacion.
- `fuentes_imagenes.csv`: trazabilidad de producto, archivo y fuente.

Regla de salida:

- PNG
- 1000x1000 px
- Fondo transparente
- Producto centrado y con margen
- Sin imagenes incorrectas aunque sean visualmente parecidas
