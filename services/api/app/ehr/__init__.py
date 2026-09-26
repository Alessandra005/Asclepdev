"""FHIR adapter implementations for external EHR systems."""

from .adapter import EHRAdapter
from .hapi import HapiAdapter
from .external import CernerAdapter, EpicAdapter

__all__ = ["CernerAdapter", "EHRAdapter", "EpicAdapter", "HapiAdapter"]