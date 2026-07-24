{{/* Full app image ref for a component: {registry}/{repo}/{name}:{tag} */}}
{{- define "api-gateway.image" -}}
{{- $reg := .root.Values.image.registry -}}
{{- $repo := .root.Values.image.repository -}}
{{- $tag := .root.Values.image.tag -}}
{{- if $reg -}}{{ $reg }}/{{ $repo }}/{{ .name }}:{{ $tag }}{{- else -}}{{ $repo }}/{{ .name }}:{{ $tag }}{{- end -}}
{{- end -}}

{{/* Infra image, optionally redirected to {registry}/tools/* for air-gap */}}
{{- define "api-gateway.infraImage" -}}
{{- if and .root.Values.airgapInfra .root.Values.image.registry -}}
{{ .root.Values.image.registry }}/tools/{{ .image }}
{{- else -}}
{{ .image }}
{{- end -}}
{{- end -}}

{{/* Shared backend (Java) env: Spring profile + DB + RabbitMQ + mail.
     Usage: {{- include "api-gateway.backendEnv" . | nindent 12 }} where "." is root */}}
{{- define "api-gateway.backendEnv" -}}
- name: SPRING_PROFILES_ACTIVE
  value: {{ .Values.springProfile | quote }}
- name: DB_HOST
  value: "api-gateway-postgres"
- name: DB_PORT
  value: "5432"
- name: DB_NAME
  value: {{ .Values.config.dbName | quote }}
- name: DB_USERNAME
  value: {{ .Values.config.dbUsername | quote }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: api-gateway-secrets
      key: db-password
- name: RABBITMQ_HOST
  value: "api-gateway-rabbitmq"
- name: RABBITMQ_PORT
  value: "5672"
- name: RABBITMQ_USERNAME
  value: {{ .Values.config.rabbitmqUsername | quote }}
- name: RABBITMQ_PASSWORD
  valueFrom:
    secretKeyRef:
      name: api-gateway-secrets
      key: rabbitmq-password
- name: RABBITMQ_VHOST
  value: {{ .Values.config.rabbitmqVhost | quote }}
{{- if .Values.config.mailHost }}
- name: MAIL_HOST
  value: {{ .Values.config.mailHost | quote }}
- name: MAIL_PORT
  value: {{ .Values.config.mailPort | quote }}
{{- end }}
{{- end -}}
