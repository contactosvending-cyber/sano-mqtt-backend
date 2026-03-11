# Sano MQTT Backend - Gestión de Máquinas Expendedoras

Backend Node.js con MQTT para gestionar máquinas expendedoras a través de protocolo MQTT. Incluye broker Mosquitto, API REST y cliente MQTT.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Network                          │
│                                                             │
│  ┌──────────────────┐        ┌──────────────────────────┐  │
│  │   Mosquitto       │◄──────►│   Backend Node.js        │  │
│  │   MQTT Broker     │        │   Express + MQTT Client  │  │
│  │   Port 1883 TCP   │        │   Port 3000              │  │
│  │   Port 9001 WS    │        └──────────────────────────┘  │
│  └──────────────────┘                    ▲                  │
│           ▲                              │                  │
└───────────┼──────────────────────────────┼──────────────────┘
            │                              │
     Máquinas Expendedoras            API REST (curl/app)
     MQTT TCP: 1883                   HTTP: 3000
     WebSocket: 9001
```

---

## Instalación y Uso

### Prerrequisitos

- Docker >= 20.10
- Docker Compose >= 2.0

### 1. Configurar contraseñas Mosquitto

Antes de arrancar, generar el archivo de contraseñas:

```bash
# Crear archivo de contraseñas (dentro del contenedor)
docker run --rm -it eclipse-mosquitto:2.0 \
  mosquitto_passwd -c -b /tmp/passwd sano_admin SanoPass2024!

# O usar la utilidad directamente si tienes mosquitto instalado:
mosquitto_passwd -c mosquitto/passwd sano_admin SanoPass2024!
```

> **Nota:** El `mosquitto.conf` referencia `/mosquitto/config/passwd`. Debes crear este archivo o ajustar la configuración para `allow_anonymous true` en desarrollo local.

### 2. Arrancar los servicios

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/sano-mqtt-backend.git
cd sano-mqtt-backend

# Arrancar todos los servicios
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f

# Ver logs de un servicio específico
docker-compose logs -f backend
docker-compose logs -f mosquitto
```

### 3. Verificar que funciona

```bash
# Health check
curl http://localhost:3000/health

# Estado del sistema
curl http://localhost:3000/api/status
```

### 4. Parar los servicios

```bash
docker-compose down

# Parar y eliminar volúmenes (borra datos persistentes)
docker-compose down -v
```

---

## Variables de Entorno

| Variable        | Valor por defecto          | Descripción                   |
|-----------------|----------------------------|-------------------------------|
| `MQTT_URL`      | `mqtt://mosquitto:1883`    | URL del broker MQTT           |
| `MQTT_USERNAME` | `sano_admin`               | Usuario MQTT                  |
| `MQTT_PASSWORD` | `SanoPass2024!`            | Contraseña MQTT               |
| `PORT`          | `3000`                     | Puerto del servidor HTTP      |

---

## API REST - Endpoints

Base URL: `http://localhost:3000`

### Formato MAC Address

El parámetro `:mac` acepta:
- Con colones: `08:7B:3A:F1:22:90`
- Sin colones: `087b3af12290`

Internamente se normaliza a minúsculas sin colones para el topic MQTT.

---

### GET /health

Estado del servicio (usado por Docker healthcheck).

**Respuesta:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "mqtt": {
    "connected": true,
    "reconnectAttempts": 0,
    "clientId": "sano-backend-1705312200000"
  }
}
```

---

### GET /api/status

Estado detallado del sistema.

```bash
curl http://localhost:3000/api/status
```

---

### PUT /api/machine/:mac/prices

Actualizar precios de productos en una máquina.

**Body:**
```json
{
  "prices": [
    { "barcode": "7501055300058", "price": "25.00" },
    { "barcode": "7501055300059", "price": "18.50" }
  ]
}
```

**Ejemplo:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/prices \
  -H "Content-Type: application/json" \
  -d '{
    "prices": [
      { "barcode": "7501055300058", "price": "25.00" },
      { "barcode": "7501055300059", "price": "18.50" }
    ]
  }'
```

**Mensaje MQTT generado:**
```json
{
  "id": "ID_PUSH_PRICE",
  "prices": [
    { "barcode": "7501055300058", "price": "25.00" },
    { "barcode": "7501055300059", "price": "18.50" }
  ]
}
```

---

### PUT /api/machine/:mac/names

Actualizar nombres de productos.

**Body:**
```json
{
  "names": [
    { "barcode": "7501055300058", "name": "Coca Cola 600ml" },
    { "barcode": "7501055300059", "name": "Agua Purificada 500ml" }
  ]
}
```

**Ejemplo:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/names \
  -H "Content-Type: application/json" \
  -d '{
    "names": [
      { "barcode": "7501055300058", "name": "Coca Cola 600ml" }
    ]
  }'
```

---

### PUT /api/machine/:mac/images

Actualizar imágenes de productos (URL o base64).

**Body:**
```json
{
  "images": [
    { "barcode": "7501055300058", "image": "https://cdn.sano.mx/products/cocacola.jpg" },
    { "barcode": "7501055300059", "image": "data:image/jpeg;base64,/9j/4AAQ..." }
  ]
}
```

**Ejemplo:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/images \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      { "barcode": "7501055300058", "image": "https://cdn.example.com/img.jpg" }
    ]
  }'
```

---

### PUT /api/machine/:mac/temperature

Configurar alarma de temperatura.

| Campo       | Tipo   | Descripción                              |
|-------------|--------|------------------------------------------|
| `threshold` | Number | Temperatura máxima en °C                 |
| `duration`  | Number | Duración en segundos antes de alarmar    |

**Body:**
```json
{
  "threshold": 8,
  "duration": 180
}
```

**Ejemplo:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/temperature \
  -H "Content-Type: application/json" \
  -d '{ "threshold": 8, "duration": 180 }'
```

**Mensaje MQTT generado:**
```json
{
  "id": "ID_TEMPER_ALARM_SET",
  "threshold": 8,
  "duration": 180
}
```

---

### PUT /api/machine/:mac/sales

Habilitar o deshabilitar ventas en una máquina.

**Body:**
```json
{ "action": "enable" }
```
o
```json
{ "action": "disable" }
```

**Ejemplo - Deshabilitar ventas:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/sales \
  -H "Content-Type: application/json" \
  -d '{ "action": "disable" }'
```

**Ejemplo - Habilitar ventas:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/sales \
  -H "Content-Type: application/json" \
  -d '{ "action": "enable" }'
```

---

### PUT /api/machine/:mac/stock

Actualizar inventario de productos en slots de la máquina.

**Body:**
```json
{
  "stocks": [
    { "barcode": "7501055300058", "slot": "A1", "quantity": 10 },
    { "barcode": "7501055300059", "slot": "A2", "quantity": 8 },
    { "barcode": "7501055300060", "slot": "B1", "quantity": 0 }
  ]
}
```

**Ejemplo:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/stock \
  -H "Content-Type: application/json" \
  -d '{
    "stocks": [
      { "barcode": "7501055300058", "slot": "A1", "quantity": 10 },
      { "barcode": "7501055300059", "slot": "A2", "quantity": 8 }
    ]
  }'
```

---

### PUT /api/machine/:mac/videos

Actualizar videos publicitarios en la pantalla de la máquina.

**Body:**
```json
{
  "ads": {
    "slot1": [
      "https://cdn.sano.mx/ads/promo_verano.mp4",
      "https://cdn.sano.mx/ads/nuevo_producto.mp4"
    ],
    "slot2": [
      "https://cdn.sano.mx/ads/descuento_2x1.mp4"
    ]
  }
}
```

**Ejemplo:**
```bash
curl -X PUT http://localhost:3000/api/machine/087b3af12290/videos \
  -H "Content-Type: application/json" \
  -d '{
    "ads": {
      "slot1": ["https://cdn.example.com/ad1.mp4"],
      "slot2": ["https://cdn.example.com/ad2.mp4"]
    }
  }'
```

**Mensaje MQTT generado:**
```json
{
  "id": "ID_ADV",
  "ads": {
    "slot1": ["https://cdn.example.com/ad1.mp4"],
    "slot2": ["https://cdn.example.com/ad2.mp4"]
  }
}
```

---

## Protocolo MQTT - Configuración para Fabricante

### Conexión

| Parámetro   | Valor                    |
|-------------|--------------------------|
| Host        | IP del servidor          |
| Puerto TCP  | `1883`                   |
| Puerto WS   | `9001`                   |
| Usuario     | `sano_admin`             |
| Contraseña  | `SanoPass2024!`          |
| QoS         | `1` (at least once)      |

### Topics

```
Recibir comandos:   machines/{mac}/command
Enviar respuestas:  machines/{mac}/response
Enviar estado:      machines/{mac}/status
```

**Formato MAC en topic:** minúsculas sin colones
- MAC `08:7B:3A:F1:22:90` → topic `machines/087b3af12290/command`

### Mensajes que recibe la máquina (desde el servidor)

```json
// Precios
{ "id": "ID_PUSH_PRICE", "prices": [{ "barcode": "...", "price": "..." }] }

// Nombres
{ "id": "ID_NAME_SET", "names": [{ "barcode": "...", "name": "..." }] }

// Imágenes
{ "id": "ID_IMAGE_SET", "images": [{ "barcode": "...", "image": "..." }] }

// Temperatura
{ "id": "ID_TEMPER_ALARM_SET", "threshold": 8, "duration": 180 }

// Control ventas
{ "id": "ID_SALE_CONTROL", "action": "enable" }
{ "id": "ID_SALE_CONTROL", "action": "disable" }

// Stock
{ "id": "ID_STOCK_SET", "stocks": [{ "barcode": "...", "slot": "A1", "quantity": 10 }] }

// Videos publicitarios
{ "id": "ID_ADV", "ads": { "slot1": ["url1", "url2"], "slot2": ["url3"] } }
```

---

## Estructura del Proyecto

```
sano-mqtt-backend/
├── docker-compose.yml       # Orquestación de servicios
├── mosquitto/
│   └── mosquitto.conf       # Configuración del broker MQTT
├── backend/
│   ├── package.json         # Dependencias Node.js
│   ├── Dockerfile           # Imagen Docker del backend
│   ├── server.js            # Servidor Express + rutas API
│   └── mqtt-client.js       # Cliente MQTT + builders de mensajes
└── README.md
```

---

## Comandos Git para GitHub

```bash
# 1. Inicializar repositorio (ya hecho)
git init
git add .
git commit -m "Initial commit: MQTT backend completo"

# 2. Crear repositorio en GitHub (usando GitHub CLI)
gh repo create sano-mqtt-backend --public --source=. --push

# 3. O conectar a repositorio existente
git remote add origin https://github.com/TU_USUARIO/sano-mqtt-backend.git
git branch -M main
git push -u origin main
```

---

## Licencia

MIT © Sano Vending
